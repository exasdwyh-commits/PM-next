import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import { getUsage } from "@/modules/usage";
import { findPlaybookForGoal, markPlaybookUsed } from "@/modules/playbooks/service";
import { instantiatePlan } from "@/modules/playbooks/match";
import {
  applyPlanEdit,
  buildMissionPlanFromGoalPlan,
  buildNewProductMissionPlan,
  initialMissionState,
  type MissionPlan,
  type MissionPlanEdit,
  type MissionPlaybook,
} from "./plan";
import { launchKernMission } from "./service";
import { buildTaskContract } from "./contract";
import type { TaskContract } from "@/modules/kern-contracts";
import { searchCapabilities } from "@/modules/assistant-runtime/capabilities/directory";
import { loadCapabilityDirectory } from "@/modules/assistant-runtime/capabilities/directory-loader";
import { resolveCapabilities } from "@/modules/assistant-runtime/capabilities/resolver";
import { requiredCompetitorQuestions, validCompetitorSubject, detectCompetitorResearch, competitorSubject, COMPETITOR_DEFAULT_SCOPE } from "./competitor-brief";
import { getMissionReadiness } from "./readiness";

/**
 * Mission Brief — the conversation step *before* a mission runs
 * =============================================================
 *
 *   CLARIFY  2–3 questions with clickable options; things Kern already
 *            remembers are pre-filled as “我记得：…” and stay editable.
 *   PLAN     steps, members, why these members, estimated usage; the user
 *            confirms, adjusts, or runs it as a demo.
 *   LAUNCHED the brief points at the mission; the live mission card takes over.
 *
 * The brief lives in the Kern message's citations (`kind: "kern-brief"`), so it
 * needs no table and is naturally scoped to the conversation owner.
 */

export const BRIEF_SCHEMA = "kern-brief/v1";

export interface BriefOption {
  id: string;
  label: string;
}

export interface BriefQuestion {
  id: string;
  text: string;
  why: string;
  options: BriefOption[];
  /** Pre-filled from memory: shown as “我记得：…”. */
  remembered: { memoryId: string; text: string } | null;
  answer: { optionId: string | null; text: string } | null;
  required?: boolean;
}

export type BriefStage = "CLARIFY" | "PLAN" | "LAUNCHED" | "DISMISSED";

export interface MissionBrief {
  schemaVersion: typeof BRIEF_SCHEMA;
  stage: BriefStage;
  goal: string;
  playbook: MissionPlaybook;
  questions: BriefQuestion[];
  plan: MissionPlan | null;
  missionTaskId: string | null;
  demo: boolean;
  memoriesUsed: { id: string; text: string }[];
  createdAt: string;
  /**
   * KX-36：套用了本人保存的做法。template 为模板化计划；defaultPlan 是不用做法时的
   * 通用计划（GENERIC 需要，NEW_PRODUCT 可以现算，为 null）。
   */
  playbookRef?: { id: string; name: string; score: number; useCount: number; successCount: number; template: MissionPlan; defaultPlan: MissionPlan | null } | null;
  /** KX-72：契约卡（PLAN 阶段生成，随计划编辑重算，开跑时写进任务）。 */
  contract?: TaskContract | null;
  /** Retain the generic plan while collecting required inputs. */
  clarifiedPlan?: MissionPlan | null;
  researchScope?: string;
}

export interface BriefEstimate {
  steps: number;
  members: number;
  modelCalls: { min: number; max: number };
  /** 本月用量（演示为 null）；limit 仅在部署设置了安全上限时有值。 */
  usage: { used: number; limit: number | null; afterLaunch: number } | null;
}

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const Q_AUDIENCE: Omit<BriefQuestion, "remembered" | "answer"> = {
  id: "audience",
  text: "主要卖给谁？",
  why: "决定市场研究和机会判断看哪群人",
  options: [
    { id: "young-pro", label: "城市年轻白领" },
    { id: "family", label: "家庭 / 宝妈" },
    { id: "smb", label: "中小企业（B2B）" },
    { id: "open", label: "还没想好，让团队研究" },
  ],
};
const Q_BUDGET: Omit<BriefQuestion, "remembered" | "answer"> = {
  id: "budget",
  text: "首轮验证的预算大概多少？",
  why: "决定验证计划的规模和成本假设",
  options: [
    { id: "lt10", label: "10 万以内，快速验证" },
    { id: "10-50", label: "10–50 万" },
    { id: "gt50", label: "50 万以上" },
    { id: "open", label: "先不设限" },
  ],
};
const Q_CHANNEL: Omit<BriefQuestion, "remembered" | "answer"> = {
  id: "channel",
  text: "优先走什么渠道？",
  why: "决定上市策略和竞品范围",
  options: [
    { id: "online", label: "线上电商 / 内容平台" },
    { id: "offline", label: "线下零售" },
    { id: "b2b", label: "企业客户直销" },
    { id: "open", label: "让团队建议" },
  ],
};

const MEMORY_HINTS: Record<string, RegExp> = {
  audience: /(用户|人群|客群|卖给|目标客户|受众)/,
  budget: /(预算|万元|万以内|\d+\s*万|资金)/,
  channel: /(渠道|线上|线下|电商|抖音|小红书|天猫|门店|直销)/,
};

/**
 * Can a memory be reused as a pre-filled answer to a clarifying question?
 *
 * Mission conclusions are stored as memories too ("「<goal>」的结论：<report>").
 * They routinely contain words like 用户/预算/渠道, so the hint regexes match them —
 * but a multi-hundred-character report is never a valid answer to "who do you sell to".
 * Prefilling from one pollutes plan.goal with another mission's output (which can
 * even trip competitor-research detection and block launch). Short, single-line,
 * non-markdown memories stay eligible.
 */
export function isUsableMemoryAnswer(content: string): boolean {
  const text = content.trim();
  if (!text || text.length > 60) return false;
  if (/[\r\n]/.test(text)) return false;
  if (/^\s*#{1,6}\s|^\s*[-*+]\s|\|/.test(text)) return false;
  if (/的结论|总结\s*[:：]/.test(text)) return false;
  return true;
}

/** Clarifying questions for a playbook, pre-filled from what Kern remembers. */
export function buildClarifyQuestions(
  playbook: MissionPlaybook,
  goal: string,
  memories: { id: string; content: string }[]
): BriefQuestion[] {
  if (playbook !== "NEW_PRODUCT") return requiredCompetitorQuestions(goal);
  return [Q_AUDIENCE, Q_BUDGET, Q_CHANNEL]
    .map((q) => {
      const hit = memories.find((m) => MEMORY_HINTS[q.id]?.test(m.content) && isUsableMemoryAnswer(m.content));
      return {
        ...q,
        remembered: hit ? { memoryId: hit.id, text: hit.content.slice(0, 120) } : null,
        answer: hit ? { optionId: null, text: hit.content.slice(0, 200) } : null,
      };
    });
}

export function answerText(q: BriefQuestion): string | null {
  if (!q.answer) return null;
  if (q.answer.optionId) {
    const o = q.options.find((x) => x.id === q.answer!.optionId);
    if (o?.id === "open") return null; // "let the team decide" is not a constraint
    return o?.label ?? q.answer.text ?? null;
  }
  return q.answer.text?.trim() || null;
}

/** Build the plan from goal + answers; answers become explicit constraints. */
export function buildBriefPlan(brief: Pick<MissionBrief, "goal" | "playbook" | "questions" | "playbookRef" | "clarifiedPlan" | "researchScope">, goalPlanFallback?: MissionPlan): MissionPlan {
  const constraints = brief.questions
    .map((q) => [q.text.replace(/[？?]$/, ""), answerText(q)] as const)
    .filter(([, a]) => !!a)
    .map(([k, a]) => `${k}：${a}`);
  let goal = constraints.length ? `${brief.goal}\n\n已确认的约束：\n${constraints.map((c) => `- ${c}`).join("\n")}` : brief.goal;
  if (detectCompetitorResearch(goal)) goal += `\n\n调研默认范围（用户明确约束优先）：${brief.researchScope ?? COMPETITOR_DEFAULT_SCOPE}`;
  if (brief.playbookRef) return instantiatePlan(brief.playbookRef.template, goal);
  if (brief.playbook === "NEW_PRODUCT") return buildNewProductMissionPlan(goal);
  const fallback = goalPlanFallback ?? brief.clarifiedPlan;
  if (!fallback) throw new UnprocessableEntityError("No plan available for this goal");
  return { ...fallback, goal };
}

export function estimateBrief(plan: MissionPlan, usage: { used: number; limit: number | null } | null, demo = false): BriefEstimate {
  const steps = plan.nodes.length;
  const members = new Set(plan.nodes.filter((n) => n.kind !== "SYNTHESIS").map((n) => n.agentCode)).size;
  const producers = plan.nodes.filter((n) => n.kind === "SPECIALIST" || n.kind === "RED_TEAM").length;
  return {
    steps,
    members,
    modelCalls: demo ? { min: 0, max: 0 } : { min: steps, max: steps + (plan.budget.maxRevisionRounds ? producers + 1 : 0) },
    usage: usage && !demo ? { used: usage.used, limit: usage.limit, afterLaunch: usage.used + 1 } : null,
  };
}

/** KX-72：由目标 + 已答问题 + 做法 + 能力目录命中生成契约卡。 */
export function briefContract(brief: Pick<MissionBrief, "plan" | "questions" | "playbookRef" | "researchScope">, capabilities: string[] = []): TaskContract | null {
  if (!brief.plan) return null;
  const answers = brief.questions
    .map((q) => ({ question: q.text.replace(/[？?]$/, ""), answer: answerText(q) }))
    .filter((a): a is { question: string; answer: string } => !!a.answer);
  if (detectCompetitorResearch(brief.plan.goal)) {
    const subject = competitorSubject(brief.plan.goal);
    if (subject && !answers.some(a => a.question === "要调研哪些品牌或产品")) answers.push({ question: "调研对象", answer: subject });
    answers.push({ question: "默认范围（明确约束优先）", answer: brief.researchScope ?? COMPETITOR_DEFAULT_SCOPE });
  }
  return buildTaskContract({ plan: brief.plan, answers, playbookName: brief.playbookRef?.name ?? null, capabilities });
}

/** KX-71/73 接线：能力包（文件式）走 Capability Resolver，原生/工具/连接器条目走能力目录；两者去重后出卡。失败不影响出卡。 */
async function suggestCapabilities(session: SessionContext, goal: string): Promise<string[]> {
  try {
    const resolution = resolveCapabilities({ text: goal, intent: "UNSUPPORTED", limit: 6 });
    const directory = await loadCapabilityDirectory(session);
    const others = searchCapabilities(
      directory.items.filter((i) => i.available && !i.capabilityId),
      goal,
      6
    ).map((i) => i.label);
    return [...new Set([...resolution.skills.map((s) => s.label), ...others])].slice(0, 6);
  } catch {
    return [];
  }
}

export function readBrief(value: unknown): MissionBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === BRIEF_SCHEMA ? (v as unknown as MissionBrief) : null;
}

export function briefCitation(messageId: string, brief: MissionBrief) {
  return { kind: "kern-brief", ref: messageId, title: "Kern 任务简报", brief };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Create the brief as the Kern reply (called by the assistant runtime). */
export async function createBriefForMessage(
  session: SessionContext,
  input: { messageId: string; goal: string; playbook: MissionPlaybook; goalPlan?: MissionPlan }
): Promise<MissionBrief> {
  const memories = await prisma.kernMemory
    .findMany({
      where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 50,
      select: { id: true, content: true },
    })
    .catch(() => [] as { id: string; content: string }[]);
  const questions = buildClarifyQuestions(input.playbook, input.goal, memories);
  const saved = await findPlaybookForGoal(session, input.goal).catch(() => null);
  const playbookRef: MissionBrief["playbookRef"] = saved ? { ...saved, defaultPlan: input.goalPlan ?? null } : null;
  const brief: MissionBrief = {
    schemaVersion: BRIEF_SCHEMA,
    stage: questions.length ? "CLARIFY" : "PLAN",
    goal: input.goal.trim().slice(0, 2000),
    playbook: input.playbook,
    questions,
    plan: questions.length ? null : buildBriefPlan({ goal: input.goal, playbook: input.playbook, questions, playbookRef }, input.goalPlan),
    missionTaskId: null,
    demo: false,
    memoriesUsed: questions.filter((q) => q.remembered).map((q) => ({ id: q.remembered!.memoryId, text: q.remembered!.text })),
    createdAt: new Date().toISOString(),
    playbookRef,
    clarifiedPlan: input.goalPlan ?? null,
    researchScope: detectCompetitorResearch(input.goal) ? COMPETITOR_DEFAULT_SCOPE : undefined,
  };
  if (brief.plan) brief.contract = briefContract(brief, await suggestCapabilities(session, brief.goal));
  return brief;
}

async function loadBriefMessage(session: SessionContext, messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, citations: true, conversation: { select: { id: true, organizationId: true, ownerId: true } } },
  });
  if (!message || message.conversation.organizationId !== session.organizationId || message.conversation.ownerId !== session.userId) {
    throw new NotFoundError("Brief not found");
  }
  const citations = Array.isArray(message.citations) ? (message.citations as unknown[]) : [];
  const idx = citations.findIndex((c) => !!c && typeof c === "object" && (c as Record<string, unknown>).kind === "kern-brief");
  const brief = idx >= 0 ? readBrief((citations[idx] as Record<string, unknown>).brief) : null;
  if (!brief) throw new NotFoundError("Brief not found");
  if ((brief.stage === "PLAN" || brief.stage === "CLARIFY") && detectCompetitorResearch(brief.goal) && !brief.researchScope) {
    brief.researchScope = COMPETITOR_DEFAULT_SCOPE;
    if (brief.plan) {
      if (!brief.plan.goal.includes("\n\n调研默认范围（用户明确约束优先）：")) brief.plan.goal += `\n\n调研默认范围（用户明确约束优先）：${COMPETITOR_DEFAULT_SCOPE}`;
      brief.contract = briefContract(brief, brief.contract?.capabilities ?? []);
    }
  }
  // Read-only upgrade of historical, unlaunched cards. The next action persists
  // this shape; no work or user inputs are lost when returning to an old chat.
  if (brief.playbook === "GENERIC" && brief.stage === "PLAN" && !brief.questions.some(q => q.id === "competitor-subject")) {
    const required = requiredCompetitorQuestions(brief.goal);
    if (required.length) {
      brief.clarifiedPlan = brief.plan;
      brief.questions = [...brief.questions, ...required];
      brief.plan = null;
      brief.stage = "CLARIFY";
    }
  }
  return { message, citations, idx, brief };
}

export async function getBrief(session: SessionContext, messageId: string) {
  const { brief } = await loadBriefMessage(session, messageId);
  return withEstimate(session, brief);
}

async function withEstimate(session: SessionContext, brief: MissionBrief) {
  const usage = await getUsage(session.organizationId).catch(() => null);
  return {
    messageId: null as string | null,
    brief,
    readiness: brief.stage === "PLAN" && brief.plan ? await getMissionReadiness(session, brief.plan) : null,
    estimate: brief.plan
      ? estimateBrief(brief.plan, usage ? { used: usage.used.missions, limit: usage.limits.missionsPerMonth } : null, brief.demo)
      : null,
  };
}

export type BriefAction =
  | { action: "answer"; answers: Record<string, { optionId?: string | null; text?: string }> }
  | { action: "skip-questions" }
  | { action: "back" }
  | { action: "edit-plan"; edits: MissionPlanEdit[] }
  | { action: "set-research-scope"; text: string }
  | { action: "launch"; demo?: boolean }
  | { action: "dismiss" }
  | { action: "drop-playbook" };

export function parseBriefAction(body: unknown): BriefAction {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  switch (b.action) {
    case "answer":
      if (b.answers && typeof b.answers === "object" && !Array.isArray(b.answers)) {
        return { action: "answer", answers: b.answers as Record<string, { optionId?: string | null; text?: string }> };
      }
      break;
    case "skip-questions":
    case "back":
    case "dismiss":
    case "drop-playbook":
      return { action: b.action };
    case "edit-plan":
      if (Array.isArray(b.edits) && b.edits.length && b.edits.length <= 12) return { action: "edit-plan", edits: b.edits as MissionPlanEdit[] };
      break;
    case "set-research-scope":
      if (typeof b.text === "string" && b.text.trim() && b.text.length <= 1000) return { action: b.action, text: b.text.trim() };
      break;
    case "launch":
      return { action: "launch", demo: b.demo === true };
  }
  throw new UnprocessableEntityError("Invalid brief action");
}

export async function actOnBrief(session: SessionContext, messageId: string, action: BriefAction) {
  const loaded = await loadBriefMessage(session, messageId);
  let brief: MissionBrief = JSON.parse(JSON.stringify(loaded.brief));
  if (brief.stage === "LAUNCHED" || brief.stage === "DISMISSED") {
    if (action.action === "launch" && brief.missionTaskId) return { ...(await withEstimate(session, brief)), messageId }; // idempotent
    throw new ConflictError(`Brief already ${brief.stage.toLowerCase()}`);
  }

  switch (action.action) {
    case "answer":
    case "skip-questions": {
      if (brief.stage !== "CLARIFY") throw new ConflictError("Questions already answered");
      if (action.action === "answer") {
        for (const q of brief.questions) {
          const a = action.answers[q.id];
          if (!a) continue;
          const optionId = a.optionId && q.options.some((o) => o.id === a.optionId) ? a.optionId : null;
          const text = typeof a.text === "string" ? a.text.trim().slice(0, 300) : "";
          q.answer = optionId || text ? { optionId, text } : null;
        }
      }
      const missing = brief.questions.filter(q => q.required && (!answerText(q) || (q.id === "competitor-subject" && !validCompetitorSubject(answerText(q)!))));
      if (missing.length) throw new UnprocessableEntityError(`请先填写：${missing.map(q => q.text).join("、")}`);
      brief.stage = "PLAN";
      brief.plan = buildBriefPlan(brief);
      brief.memoriesUsed = brief.questions
        .filter((q) => q.remembered && q.answer?.text === q.remembered.text && !q.answer.optionId)
        .map((q) => ({ id: q.remembered!.memoryId, text: q.remembered!.text }));
      break;
    }
    case "back":
      if (!brief.questions.length) throw new ConflictError("No questions to revisit");
      brief.stage = "CLARIFY";
      brief.plan = null;
      break;
    case "edit-plan": {
      if (brief.stage !== "PLAN" || !brief.plan) throw new ConflictError("No plan to edit yet");
      const edited = applyPlanEdit(brief.plan, initialMissionState(brief.plan), action.edits);
      if ("error" in edited) throw new UnprocessableEntityError(`Cannot edit plan: ${edited.error}`);
      brief.plan = edited.plan;
      break;
    }
    case "dismiss":
      brief.stage = "DISMISSED";
      break;
    case "drop-playbook": {
      if (!brief.playbookRef) throw new ConflictError("No saved playbook in use");
      const fallback = brief.playbookRef.defaultPlan ?? undefined;
      brief.playbookRef = null;
      if (brief.stage === "PLAN") brief.plan = buildBriefPlan(brief, fallback);
      break;
    }
    case "set-research-scope": {
      if (brief.stage !== "PLAN" || !brief.plan || !detectCompetitorResearch(brief.goal)) throw new ConflictError("当前计划不支持调整调研范围");
      const text = action.text.trim();
      if (!text || text.length > 1000) throw new UnprocessableEntityError("请填写不超过 1000 字的调研范围");
      brief.researchScope = text;
      const baseGoal = brief.plan.goal.split("\n\n调研默认范围（用户明确约束优先）：")[0];
      brief.plan = { ...brief.plan, goal: `${baseGoal}\n\n调研默认范围（用户明确约束优先）：${text}` };
      break;
    }
    case "launch": {
      if (brief.stage !== "PLAN" || !brief.plan) throw new ConflictError("Confirm the questions first");
      const readiness = await getMissionReadiness(session, brief.plan);
      const blockers = action.demo ? readiness.blockers.filter(b => ["INPUT", "TEAM", "WORKER"].includes(b.code)) : readiness.blockers;
      if (blockers.length) throw new UnprocessableEntityError(blockers.map(b => b.message).join("；"));
      const conversationId = loaded.message.conversation.id;
      const launched = await launchKernMission(session, {
        plan: brief.plan,
        conversationId,
        sourceRunId: null,
        idempotencyKey: `kern-brief:${messageId}`,
        demo: action.demo === true,
        memoriesUsed: brief.memoriesUsed,
        playbookRef: brief.playbookRef ? { id: brief.playbookRef.id, name: brief.playbookRef.name } : undefined,
        contract: brief.contract ?? briefContract(brief),
      });
      if (launched.created && brief.playbookRef && action.demo !== true) await markPlaybookUsed(brief.playbookRef.id).catch(() => undefined);
      brief.stage = "LAUNCHED";
      brief.demo = action.demo === true;
      brief.missionTaskId = launched.missionTaskId;
      break;
    }
  }

  // KX-72：计划变了契约卡跟着重算；开跑后不再动。
  if (brief.stage === "PLAN" && brief.plan) {
    const keep = brief.contract?.capabilities ?? (await suggestCapabilities(session, brief.goal));
    brief.contract = briefContract(brief, keep);
  } else if (brief.stage === "CLARIFY") {
    brief.contract = null;
  }

  const citations = [...loaded.citations];
  citations[loaded.idx] = briefCitation(messageId, brief);
  if (brief.stage === "LAUNCHED" && brief.missionTaskId && !citations.some((c) => (c as Record<string, unknown>)?.kind === "kern-mission")) {
    citations.push({ kind: "kern-mission", ref: brief.missionTaskId, title: "Kern 工作进展" });
  }
  await prisma.message.update({ where: { id: messageId }, data: { citations: JSON.parse(JSON.stringify(citations)) as Prisma.InputJsonValue } });
  return { ...(await withEstimate(session, brief)), messageId };
}

export { buildMissionPlanFromGoalPlan };
