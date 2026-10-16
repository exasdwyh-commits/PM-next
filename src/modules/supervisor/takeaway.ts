/**
 * Take-away: turn a finished mission into something that lives on outside the
 * conversation — a Markdown/PDF report, or a Proposal the user confirms into
 * a product+project or a work item.
 *
 * Proposals go through the existing advisor proposal pipeline (idempotency,
 * validation, confirm → receipt, 首页「需要你」). Nothing is written to
 * business tables here; the user's confirm does that.
 *
 * Demo missions can be exported (clearly labelled) but never proposed:
 * demo data must not reach business tables.
 *
 * 质量门禁：与导出一致（见 takeawayGate）。BLOCKED 的结论不能带走；
 * 待补证草稿放行，但确认卡上会带状态戳与问题清单。
 */
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { ConflictError, UnprocessableEntityError } from "@/shared/errors";
import { createProposal } from "@/modules/advisor/proposals";
import { agentLabel, nodeLabel } from "./labels";
import { collectMissionSources, loadMissionSourceEvents, uniqueMissionSources } from "./research-sources";
import { getKernMissionStatus } from "./service";
import {
  answerFor,
  conclusionLead,
  extractDecision,
  extractRecommendation,
  goalAudience,
  parseConstraints,
  reportTitle,
  type MissionReport,
} from "./report-format";

import { reportContentInputVersion, validateReportContentDraft, reviewReportContent } from "./report-content-agent";
import { readReportContentArtifact } from "./report-content-store";
import { planMissionDelivery } from "./report-delivery";
import { REPORT_QUALITY_LABEL, type ReportQuality } from "./report-quality";

export async function loadMissionReport(session: SessionContext, missionTaskId: string): Promise<MissionReport> {
  const status = await getKernMissionStatus(session, missionTaskId);
  const taskIds = status.nodes.map((n) => n.taskId).filter((id): id is string => !!id);
  const tasks = taskIds.length
    ? await prisma.agentTask.findMany({ where: { id: { in: taskIds }, organizationId: session.organizationId }, select: { id: true, contextSnapshot: true } })
    : [];
  const outputOf = new Map<string, string>();
  for (const t of tasks) {
    const r = (t.contextSnapshot as { executorResult?: { output?: unknown; raw?: unknown } } | null)?.executorResult;
    const text = typeof r?.output === "string" ? r.output : typeof r?.raw === "string" ? r.raw : null;
    if (text) outputOf.set(t.id, text);
  }
  const out = (n: (typeof status.nodes)[number]) => (n.taskId ? outputOf.get(n.taskId) : undefined) ?? n.summary ?? null;
  const synth = status.nodes.find((n) => n.kind === "SYNTHESIS");
  const conclusion = synth ? out(synth) : null;
  const synthesisResult = (tasks.find(t => t.id === synth?.taskId)?.contextSnapshot as {
    executorResult?: { originalOutput?: unknown; contentArtifactId?: unknown; contentInputVersion?: unknown } } | null)?.executorResult;
  const report: MissionReport = {
    missionTaskId: status.missionTaskId,
    playbook: status.playbook,
    title: reportTitle(status.goal),
    goal: status.goal,
    status: status.status,
    outcome: status.outcome?.status ?? null,
    demo: status.demo,
    createdAt: status.createdAt,
    constraints: parseConstraints(status.goal),
    conclusion,
    ...(typeof synthesisResult?.originalOutput === "string" ? { originalConclusion: synthesisResult.originalOutput } : {}),
    researchSources: status.demo ? [] : uniqueMissionSources(collectMissionSources(await loadMissionSourceEvents(session.organizationId, missionTaskId))),
    decision: extractDecision(conclusion),
    recommendation: extractRecommendation(conclusion),
    steps: status.nodes
      .filter((n) => n.kind !== "SYNTHESIS")
      .map((n) => ({ key: n.key, label: nodeLabel(n.key), agent: agentLabel(n.agentCode), status: n.status, output: out(n) })),
    meta: {
      tasksCreated: status.tasksCreated,
      maxTasks: status.budget.maxTasks,
      memoriesUsed: status.memoriesUsed.map((m) => m.text),
      successCriteria: status.successCriteria,
      humanGates: status.humanGates,
    },
  };
  if (status.playbook === "NEW_PRODUCT") {
    report.contentStatus = "MISSING";
    // Authorization above is requester-scoped. A guessed Artifact id is never a lookup authority.
    const result = synthesisResult;
    const inputVersion = reportContentInputVersion(report);
    if (synth?.taskId && typeof result?.contentArtifactId === "string" && result.contentInputVersion === inputVersion) {
      const content = await readReportContentArtifact(session.organizationId, result.contentArtifactId, missionTaskId, synth.taskId, inputVersion);
      if (content) {
        try {
          if (content.source.goal !== report.goal || content.source.body !== report.conclusion || content.source.originalBody !== (report.originalConclusion ?? report.conclusion)) throw new Error("Stored source snapshot mismatch");
          // Revalidate stored shape and all source anchors before handing it to a template.
          if (content.status === "READY" || content.status === "DRAFT" || content.status === "REJECTED") validateReportContentDraft(content, report);
          if (content.status === "READY") {
            const checked = reviewReportContent(content, { ...content.review, title: content.title, summary: content.summary, layout: content.layout }, report);
            if (checked.status !== "READY") throw new Error("Invalid publication review");
          }
          report.content = content;
          report.contentStatus = content.status;
          report.contentArtifactId = result.contentArtifactId;
          if (content.status === "READY") report.title = reportTitle(report.goal, content);
        } catch { report.contentStatus = "FAILED"; }
      }
    }
  }
  return report;
}

export type TakeawayTarget = "product" | "work-item";

export type TakeawayOptions = {
  missionTaskId: string;
  target: TakeawayTarget;
};

/**
 * 带走与导出共用的质量口径（R1·report-quality/v1）。
 *
 * 导出（/api/missions/[id]/export）早就走 planMissionDelivery：BLOCKED 直接 409，
 * 待补证草稿放行但标题带状态戳、正文带问题清单。「带走结论」此前完全没看质量，
 * 是唯一能把研究对象错配、演示冒充这类结论写进业务表的通路 —— 两者必须同一个口径。
 *
 * - blocked：非空即拒绝，文案直接给用户看（逐条问题）。
 * - pendingNote：待补证草稿的提示戳，拼进确认卡上的 rationale；
 *   与导出的「标题带戳」等价 —— 放行，但用户在看到问题清单的前提下确认。
 */
export function takeawayGate(report: MissionReport): { blocked: string | null; pendingNote: string; quality: ReportQuality | null } {
  const plan = planMissionDelivery(report);
  if (plan.blocked) return { blocked: plan.blockedReason, pendingNote: "", quality: plan.quality };
  const pending = plan.quality && plan.quality.status !== "DELIVERABLE" ? plan.quality : null;
  const pendingNote = pending
    ? `［${REPORT_QUALITY_LABEL[pending.status]}，还需补证${pending.issues.length ? `：${pending.issues.map((issue) => `${issue.where}：${issue.detail}`).join("；")}` : ""}］`
    : "";
  return { blocked: null, pendingNote, quality: plan.quality };
}

/** What the UI can offer for this mission (and why not, when it can't). */
export async function takeawayOptions(session: SessionContext, missionTaskId: string) {
  const status = await getKernMissionStatus(session, missionTaskId);
  const project = await boundProject(session, status.conversationId);
  let blocked = status.demo ? "演示运行的数据不会写入业务，不能带走。" : status.outcome?.status !== "COMPLETED" ? "任务完成后才能带走结论。" : null;
  let quality: ReportQuality | null = null;
  // 便宜的前置判据都过了才付质量判定的代价（loadMissionReport 会读节点产出与来源事件）。
  if (!blocked) {
    const gate = takeawayGate(await loadMissionReport(session, missionTaskId));
    quality = gate.quality;
    if (gate.blocked) blocked = gate.blocked;
  }
  return {
    blocked,
    product: !blocked && !project,
    workItem: !blocked && !!project,
    project: project ? { id: project.id, title: project.title } : null,
    quality: quality
      ? {
          status: quality.status,
          label: REPORT_QUALITY_LABEL[quality.status],
          issues: quality.issues.map((issue) => ({ where: issue.where, detail: issue.detail, fix: issue.fix })),
        }
      : null,
  };
}

async function boundProject(session: SessionContext, conversationId: string | null | undefined) {
  if (!conversationId) return null;
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId },
    select: { productId: true },
  });
  if (!conv?.productId) return null;
  return prisma.project.findFirst({
    where: { organizationId: session.organizationId, productId: conv.productId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });
}

/**
 * Create (idempotently) the take-away proposal. Returns the proposal id; the
 * card appears in the conversation and in 首页「需要你」 for confirmation.
 */
export async function proposeMissionTakeaway(session: SessionContext, opts: TakeawayOptions) {
  const report = await loadMissionReport(session, opts.missionTaskId);
  if (report.demo) throw new UnprocessableEntityError("演示运行的数据不会写入业务，不能带走。先用真实运行得出结论。");
  if (report.outcome !== "COMPLETED" || !report.conclusion) throw new ConflictError("任务完成、形成结论后才能带走。");
  // 与导出（/api/missions/[id]/export）同一个门禁口径，见 takeawayGate。
  const gate = takeawayGate(report);
  if (gate.blocked) throw new UnprocessableEntityError(gate.blocked);
  const status = await getKernMissionStatus(session, opts.missionTaskId);
  const conversationId = status.conversationId ?? null;
  const rationale = `来自 Kern 任务「${report.title}」的结论${gate.pendingNote}${report.decision ? `；待你决定：${report.decision.slice(0, 120)}` : ""}`;

  if (opts.target === "work-item") {
    const project = await boundProject(session, conversationId);
    if (!project) throw new UnprocessableEntityError("这段对话还没有绑定项目。先把结论带走为新产品并立项。");
    const result = await createProposal(session, {
      actionType: "CREATE_WORK_ITEM",
      projectId: project.id,
      conversationId,
      idempotencyKey: `kern:mission:${report.missionTaskId}:takeaway:work-item`,
      rationale,
      payload: {
        projectId: project.id,
        title: `落实：${report.recommendation ?? report.title}`.slice(0, 120),
        target: report.decision ?? conclusionLead(report.conclusion) ?? report.title,
        deliverableReq: stepLead(report, "validation") ?? "按 Kern 结论中的验证计划产出验证结果与结论说明",
      },
    });
    return { ...result, target: opts.target, projectTitle: project.title };
  }

  // CREATE_PRODUCT requires the five intake fields; every value comes from the
  // user's own answers or the mission's conclusion — never a placeholder.
  const fields = {
    name: report.recommendation ?? report.title.slice(0, 60),
    coreIdea: conclusionLead(report.conclusion),
    targetAudience: answerFor(report, /卖给谁|人群|用户/) ?? goalAudience(report.goal) ?? stepLead(report, "opportunity", /目标用户|人群/),
    coreSellingPoints: stepLead(report, "opportunity", /卖点|价值主张|差异化/) ?? conclusionLead(report.conclusion, 80),
    targetChannels: answerFor(report, /渠道/) ?? stepLead(report, "gtm", /渠道/),
  };
  const missing = Object.entries(fields).filter(([, v]) => !v || /让团队/.test(v)).map(([k]) => FIELD_LABEL[k]);
  if (missing.length) {
    throw new UnprocessableEntityError(`结论里还缺：${missing.join("、")}。在对话里补一句（比如"主要卖给…"），或在工作台手动建产品。`);
  }
  const budget = answerFor(report, /预算/);
  const result = await createProposal(session, {
    actionType: "CREATE_PRODUCT",
    conversationId,
    idempotencyKey: `kern:mission:${report.missionTaskId}:takeaway:product`,
    rationale,
    payload: { ...fields, priceExpectation: budget ? `首轮验证预算：${budget}` : null },
  });
  return { ...result, target: opts.target, projectTitle: null };
}

const FIELD_LABEL: Record<string, string> = {
  name: "产品名称",
  coreIdea: "一句话想法",
  targetAudience: "目标人群",
  coreSellingPoints: "核心卖点",
  targetChannels: "渠道",
};

/** A line from a step's output (optionally the first line matching `hint`). */
function stepLead(report: MissionReport, key: string, hint?: RegExp): string | null {
  const text = report.steps.find((s) => s.key === key)?.output;
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.replace(/\*\*/g, "").replace(/^\s*(#{1,6}|[-*•]|\d+[.、)])\s+/, "").trim()).filter(Boolean);
  const hit = hint ? lines.find((l) => hint.test(l) && l.length > 6) : lines[0];
  if (!hit) return null;
  const cleaned = hint ? hit.replace(/^[^：:]{0,12}[：:]\s*/, "") : hit;
  return cleaned.slice(0, 200) || null;
}
