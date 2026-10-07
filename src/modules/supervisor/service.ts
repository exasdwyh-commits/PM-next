import { AgentTaskStatus, AgentTriggerType, KernMemoryKind, Prisma } from "@prisma/client";
import { rememberForUser, extractTopics } from "@/modules/memory";
import { assertMissionUsage } from "@/modules/usage";
import { recordPlaybookOutcome } from "@/modules/playbooks/service";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import {
  applyRevision,
  decideMissionStep,
  initialMissionState,
  isTerminalNodeStatus,
  revisionImpact,
  validateMissionPlan,
  prepareMissionResume,
  type MissionNodeStatus,
  type MissionOutcome,
  type MissionPlan,
  type MissionQaVerdict,
  type MissionNodeState,
  type MissionState,
} from "./plan";
import { estimateMissionProgress } from "./plan";
import { MISSION_NODE_SCHEMA, type MissionNodeContext } from "./generic-executor";
import { appendMissionEventsTx, type MissionEventInput } from "./events";
import { checkTaskContract } from "./contract";
import { automationEligibility, computeMissionMetrics } from "./metrics";
import { listMissionEventsUnchecked } from "./events";
import type { MissionMetrics, TaskContract } from "@/modules/kern-contracts";

/**
 * Kern Supervisor Runtime
 * =======================
 *
 * A mission is one root AgentTask owned by Kern (`hermes_pm`, status RUNNING)
 * whose contextSnapshot holds the plan + node state. Every node runs as a real
 * child AgentTask (with AgentDelegation lineage), executed by the existing
 * worker. Child completion calls `advanceKernMission`, which is idempotent and
 * serialized by a row lock on the root task. Every transition is also appended
 * to KernMissionEvent (ordered per mission) for the live timeline.
 */

export const MISSION_SCHEMA = "kern-mission/v1";

export interface MissionSnapshot {
  schemaVersion: typeof MISSION_SCHEMA;
  plan: MissionPlan;
  state: MissionState;
  conversationId: string | null;
  sourceRunId: string | null;
  requestedByUserId: string;
  log: { at: string; event: string; detail?: string }[];
  outcome: { status: MissionOutcome; reasons: string[]; messageId: string | null; finishedAt: string } | null;
  /** User paused: no new dispatch; active steps finish. */
  paused?: { at: string; byUserId: string } | null;
  /** Mid-flight user input, carried into every step dispatched afterwards. */
  userInputs?: MissionUserInput[];
  /** Demo missions never write business data and never consume quota. */
  demo?: boolean;
  /** Memories that shaped this mission (shown as meta info). */
  memoriesUsed?: { id: string; text: string }[];
  /** KX-36：按本人保存的做法启动。 */
  playbookRef?: { id: string; name: string };
  /** KX-72：任务契约；COMPLETED 时自动项被检查，用户可按条复核 / 打回。 */
  contract?: TaskContract | null;
  /** KX-73：结束时与每次复核后刷新的结果指标。 */
  metrics?: MissionMetrics | null;
}

export interface MissionUserInput {
  id: string;
  at: string;
  text: string;
  appliedTo: string[];
}

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function readMissionSnapshot(value: unknown): MissionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === MISSION_SCHEMA ? (v as unknown as MissionSnapshot) : null;
}

function childStatusToNode(status: AgentTaskStatus): MissionNodeStatus {
  switch (status) {
    case AgentTaskStatus.SUCCEEDED:
      return "SUCCEEDED";
    case AgentTaskStatus.FAILED:
    case AgentTaskStatus.CANCELLED:
      return "FAILED";
    case AgentTaskStatus.BLOCKED:
    case AgentTaskStatus.WAITING_HUMAN:
      return "BLOCKED";
    default:
      return "ACTIVE";
  }
}

export async function launchKernMission(
  session: SessionContext,
  input: {
    plan: MissionPlan;
    conversationId: string | null;
    sourceRunId: string | null;
    idempotencyKey?: string;
    /** Demo: same UI, canned outputs, no model calls, no quota. */
    demo?: boolean;
    memoriesUsed?: { id: string; text: string }[];
    playbookRef?: { id: string; name: string };
    /** KX-72：开跑前确认过的任务契约。 */
    contract?: TaskContract | null;
  }
): Promise<{ missionTaskId: string; created: boolean }> {
  const errors = validateMissionPlan(input.plan);
  if (errors.length) throw new UnprocessableEntityError("Invalid mission plan: " + errors.join("; "));

  const kern = await prisma.agent.findFirst({
    where: { organizationId: session.organizationId, code: "hermes_pm", status: "ACTIVE" },
    select: { id: true },
  });
  if (!kern) throw new UnprocessableEntityError("Kern PM agent is not active; run workforce bootstrap first");

  const idempotencyKey = input.idempotencyKey ?? (input.sourceRunId ? `kern-mission:${input.sourceRunId}` : null);
  if (idempotencyKey) {
    const existing = await prisma.agentTask.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { missionTaskId: existing.id, created: false };
  }

  if (!input.demo) await assertMissionUsage(session.organizationId);

  const snapshot: MissionSnapshot = {
    schemaVersion: MISSION_SCHEMA,
    plan: input.plan,
    state: initialMissionState(input.plan),
    conversationId: input.conversationId,
    sourceRunId: input.sourceRunId,
    requestedByUserId: session.userId,
    log: [{ at: new Date().toISOString(), event: "LAUNCHED", detail: input.plan.playbook }],
    outcome: null,
    ...(input.demo ? { demo: true } : {}),
    ...(input.memoriesUsed?.length ? { memoriesUsed: input.memoriesUsed } : {}),
    ...(input.playbookRef ? { playbookRef: input.playbookRef } : {}),
    ...(input.contract ? { contract: input.contract } : {}),
  };

  let root: { id: string };
  try {
    root = await prisma.$transaction(async (tx) => {
      const task = await tx.agentTask.create({
        data: {
          organizationId: session.organizationId,
          agentId: kern.id,
          goal: input.plan.goal.slice(0, 2000),
          contextSnapshot: toJson(snapshot),
          status: AgentTaskStatus.RUNNING,
          startedAt: new Date(),
          priority: 60,
          triggerType: AgentTriggerType.MANUAL,
          triggerRef: input.conversationId ? `conversation:${input.conversationId}` : null,
          idempotencyKey,
          createdByUserId: session.userId,
        },
        select: { id: true },
      });
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "KERN_MISSION_LAUNCHED",
        objectType: "AgentTask",
        objectId: task.id,
        summary: `Kern 接手目标（${input.plan.playbook}，${input.plan.nodes.length} 个节点）：${input.plan.goal.slice(0, 100)}`,
        details: toJson({ nodes: input.plan.nodes.map((n) => `${n.key}:${n.agentCode}`), conversationId: input.conversationId }),
      });
      await appendMissionEventsTx(tx, {
        organizationId: session.organizationId,
        missionTaskId: task.id,
        demo: !!input.demo,
        events: [
          {
            type: "mission.launched",
            actorUserId: session.userId,
            payload: {
              goal: input.plan.goal,
              playbook: input.plan.playbook,
              budget: input.plan.budget,
              demo: !!input.demo,
              memoriesUsed: input.memoriesUsed ?? [],
              nodes: input.plan.nodes.map((n) => ({ key: n.key, kind: n.kind, agentCode: n.agentCode, objective: n.objective, dependsOn: n.dependsOn, critical: n.critical })),
            },
          },
        ],
      });
      return task;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && idempotencyKey) {
      const existing = await prisma.agentTask.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (existing) return { missionTaskId: existing.id, created: false };
    }
    throw error;
  }

  await advanceKernMission(session, root.id);
  return { missionTaskId: root.id, created: true };
}

/**
 * Reconcile child tasks into mission state and take the next supervisor actions.
 * Safe to call any number of times (worker loop, child completion, API).
 */
export async function advanceKernMission(session: SessionContext, missionTaskId: string) {
  const transition = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      missionTaskId,
      session.organizationId
    );
    const root = await tx.agentTask.findUnique({
      where: { id: missionTaskId },
      select: { id: true, status: true, organizationId: true, agentId: true, createdByUserId: true, contextSnapshot: true, priority: true },
    });
    if (!root || root.organizationId !== session.organizationId) throw new NotFoundError("Mission not found");
    const snap = readMissionSnapshot(root.contextSnapshot);
    if (!snap) throw new UnprocessableEntityError("Task is not a Kern mission");
    if (snap.outcome) return { snapshot: snap, justFinished: false };
    if (root.status !== AgentTaskStatus.RUNNING) return null;

    const plan = snap.plan;
    let state = snap.state;
    const log = snap.log;
    const events: MissionEventInput[] = [];
    const userInputs = snap.userInputs ?? [];
    const paused = !!snap.paused;
    const now = () => new Date().toISOString();

    // 1. reconcile child task outcomes
    const childIds = Object.values(state.nodes).map((n) => n.taskId).filter((id): id is string => !!id);
    const children = childIds.length
      ? await tx.agentTask.findMany({
          where: { id: { in: childIds } },
          select: {
            id: true,
            status: true,
            blockedReason: true,
            contextSnapshot: true,
            runs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, outputSummary: true, durationMs: true } },
          },
        })
      : [];
    const childById = new Map(children.map((c) => [c.id, c]));
    for (const [key, ns] of Object.entries(state.nodes)) {
      if (ns.status !== "ACTIVE" || !ns.taskId) continue;
      const child = childById.get(ns.taskId);
      if (!child) continue;
      const status = childStatusToNode(child.status);
      if (status === "ACTIVE") continue;
      ns.status = status;
      ns.summary = child.runs[0]?.outputSummary ?? null;
      ns.reason = child.blockedReason ?? null;
      const exec = (child.contextSnapshot as Record<string, unknown> | null)?.executorResult as
        | Record<string, unknown>
        | undefined;
      ns.qa = exec?.kind === "MISSION_QA" ? ((exec.verdict as MissionQaVerdict) ?? null) : null;
      ns.signals = Array.isArray(exec?.signals) ? (exec.signals as MissionNodeState["signals"]) : [];
      log.push({ at: now(), event: `NODE_${status}`, detail: key });
      events.push({
        type: "node.finished",
        nodeKey: key,
        payload: {
          status,
          summary: ns.summary,
          signals: ns.signals,
          reason: ns.reason,
          attempt: ns.attempts,
          taskId: child.id,
          agentRunId: child.runs[0]?.id ?? null,
          durationMs: child.runs[0]?.durationMs ?? null,
          provider: (exec?.provider as string | undefined) ?? null,
          model: (exec?.modelId as string | undefined) ?? null,
          modelRunId: (exec?.modelRunId as string | undefined) ?? null,
          qa: ns.qa,
        },
      });
    }

    // 2. decide & apply until stable (REVISE produces new dispatches)
    let outcome: MissionSnapshot["outcome"] = null;
    for (let guard = 0; guard < 4; guard++) {
      const actions = decideMissionStep(plan, state);
      if (!actions.length) break;
      let changed = false;
      for (const action of actions) {
        if (action.type === "FINISH") {
          const reasons = isModelUnavailableMission({ ...snap, state })
            ? ["MODEL_UNAVAILABLE", ...action.reasons]
            : action.reasons;
          outcome = { status: action.outcome, reasons, messageId: null, finishedAt: now() };
          log.push({ at: now(), event: `MISSION_${action.outcome}`, detail: action.reasons.join(",") });
          events.push({ type: "mission.finished", payload: { outcome: action.outcome, reasons } });
          break;
        }
        if (action.type === "REVISE") {
          // 谁被推翻、谁被连带作废，与状态重置同源计算（见 plan.revisionImpact）。
          const impact = revisionImpact(plan, action);
          state = applyRevision(plan, state, action);
          log.push({ at: now(), event: "QA_REVISION", detail: action.nodeKeys.join(",") });
          events.push({ type: "qa.revise", payload: { round: state.revisionRounds, nodeKeys: action.nodeKeys, feedback: action.feedback } });
          for (const key of impact.refuted) {
            events.push({
              type: "node.refuted",
              nodeKey: key,
              payload: { round: state.revisionRounds, feedback: action.feedback[key] ?? null },
            });
          }
          // 下游此前给出的结论从这一刻起不作数——以前它只是被悄悄重算，用户无从得知。
          for (const key of impact.retracted) {
            events.push({
              type: "node.retracted",
              nodeKey: key,
              payload: { round: state.revisionRounds, cause: "UPSTREAM_REFUTED", upstream: impact.refuted },
            });
          }
          changed = true;
          break;
        }
        if (action.type === "SKIP") {
          state.nodes[action.nodeKey].status = "SKIPPED";
          state.nodes[action.nodeKey].reason = action.reason;
          log.push({ at: now(), event: "NODE_SKIPPED", detail: `${action.nodeKey}:${action.reason}` });
          events.push({ type: "node.skipped", nodeKey: action.nodeKey, payload: { reason: action.reason } });
          changed = true;
          continue;
        }
        // DISPATCH (held while the user has the mission paused)
        if (paused) continue;
        const node = plan.nodes.find((n) => n.key === action.nodeKey)!;
        const ns = state.nodes[node.key];
        const agent = await tx.agent.findFirst({
          where: { organizationId: session.organizationId, code: node.agentCode, status: "ACTIVE" },
          select: { id: true, name: true },
        });
        if (!agent) {
          ns.status = "BLOCKED";
          ns.reason = `AGENT_UNAVAILABLE:${node.agentCode}`;
          log.push({ at: now(), event: "NODE_BLOCKED", detail: `${node.key}:no active ${node.agentCode}` });
          events.push({ type: "node.finished", nodeKey: node.key, payload: { status: "BLOCKED", reason: ns.reason } });
          changed = true;
          continue;
        }
        const nodeContext: MissionNodeContext = {
          schemaVersion: MISSION_NODE_SCHEMA,
          missionTaskId: root.id,
          missionGoal: plan.goal,
          nodeKey: node.key,
          kind: node.kind,
          objective: node.objective,
          taskClass: node.taskClass,
          upstream: node.dependsOn.map((d) => ({
            key: d,
            agentCode: plan.nodes.find((n) => n.key === d)?.agentCode ?? "unknown",
            status: state.nodes[d].status,
            summary: state.nodes[d].summary,
          })),
          revisionFeedback: ns.revisionFeedback,
          userInputs: userInputs.map((u) => ({ id: u.id, text: u.text })),
        };
        const attempt = ns.attempts + 1;
        const child = await tx.agentTask.create({
          data: {
            organizationId: session.organizationId,
            agentId: agent.id,
            parentTaskId: root.id,
            goal: `[${node.key}] ${node.objective}`.slice(0, 2000),
            contextSnapshot: toJson(nodeContext),
            priority: root.priority,
            triggerType: AgentTriggerType.DELEGATION,
            triggerRef: root.id,
            idempotencyKey: `kern-mission:${root.id}:${node.key}:${attempt}`,
            createdByUserId: root.createdByUserId,
          },
          select: { id: true },
        });
        // AgentDelegation forbids self-delegation; Kern's own synthesis node
        // keeps lineage through parentTaskId only.
        if (agent.id !== root.agentId) await tx.agentDelegation.create({
          data: {
            organizationId: session.organizationId,
            fromAgentId: root.agentId,
            toAgentId: agent.id,
            parentTaskId: root.id,
            childTaskId: child.id,
            reason: `Kern mission node ${node.key}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
            createdByUserId: root.createdByUserId,
          },
        });
        ns.status = "ACTIVE";
        ns.taskId = child.id;
        ns.attempts = attempt;
        state.tasksCreated += 1;
        log.push({ at: now(), event: "NODE_DISPATCHED", detail: `${node.key}→${node.agentCode}` });
        events.push({
          type: "node.dispatched",
          nodeKey: node.key,
          payload: { agentCode: node.agentCode, agentName: agent.name, kind: node.kind, attempt, taskId: child.id, objective: node.objective, revision: !!ns.revisionFeedback },
        });
        for (const u of userInputs) {
          if (u.appliedTo.includes(node.key)) continue;
          u.appliedTo.push(node.key);
          events.push({ type: "user.input.applied", nodeKey: node.key, payload: { inputId: u.id } });
        }
        changed = true;
      }
      if (outcome || !changed) break;
    }

    // KX-72：任务完成时跑契约的自动项（关键步骤 / QA / 分节 / 事实标注），结果随快照保存。
    const synthKey = plan.nodes.find((n) => n.kind === "SYNTHESIS")?.key;
    const contract =
      outcome?.status === "COMPLETED" && snap.contract
        ? checkTaskContract(snap.contract, plan, state, synthKey ? state.nodes[synthKey]?.summary ?? null : null)
        : snap.contract;
    const nextSnap: MissionSnapshot = { ...snap, state, log: log.slice(-200), outcome, ...(snap.userInputs ? { userInputs } : {}), ...(contract ? { contract } : {}) };
    // KX-53：关键帧带真实进度（按推进后的状态估算）。
    const progress = estimateMissionProgress(snap.plan, state);
    const framed = events.map((e) =>
      e.type === "node.dispatched" || e.type === "node.finished" || e.type === "node.skipped" || e.type === "mission.finished"
        ? { ...e, payload: { ...(e.payload ?? {}), progress } }
        : e
    );
    await appendMissionEventsTx(tx, { organizationId: session.organizationId, missionTaskId: root.id, demo: !!snap.demo, events: framed });
    await tx.agentTask.update({
      where: { id: root.id },
      data: {
        contextSnapshot: toJson(nextSnap),
        ...(outcome
          ? {
              status: outcome.status === "COMPLETED" ? AgentTaskStatus.SUCCEEDED : AgentTaskStatus.WAITING_HUMAN,
              completedAt: outcome.status === "COMPLETED" ? new Date() : null,
              blockedReason: outcome.status === "NEEDS_USER" ? outcome.reasons.join(", ").slice(0, 1000) : null,
            }
          : {}),
      },
    });
    return outcome ? { snapshot: nextSnap, justFinished: true } : null;
  });

  const finished = transition?.justFinished ? transition.snapshot : null;
  // KX-36：按做法跑的工作，按结果给做法计成功 / 未成功（匹配时成功率高的优先）。不依赖是否挂在对话上。
  if (finished?.playbookRef && finished.outcome && !finished.demo) {
    await recordPlaybookOutcome(finished.playbookRef.id, finished.outcome.status === "COMPLETED").catch(() => undefined);
  }
  if (finished) await refreshMissionMetrics(session.organizationId, missionTaskId).catch(() => undefined);
  if (transition?.snapshot.outcome && !transition.snapshot.outcome.messageId) await reportMissionToConversation(session, missionTaskId).catch((error: unknown) => {
    console.error(`[kern-supervisor] mission report failed ${missionTaskId}:`, error instanceof Error ? error.message : error);
    // Retry delivery later, without taking capacity from active execution. The
    // terminal-state guard prevents an old delivery failure delaying a rerun.
    return prisma.agentTask.updateMany({ where: {
      id: missionTaskId, organizationId: session.organizationId,
      status: { in: [AgentTaskStatus.SUCCEEDED, AgentTaskStatus.WAITING_HUMAN, AgentTaskStatus.CANCELLED, AgentTaskStatus.FAILED] },
      contextSnapshot: { path: ["outcome", "messageId"], equals: Prisma.JsonNull },
    }, data: { availableAt: new Date(Date.now() + 30_000) } }).catch(() => undefined);
  });
  return loadMissionStatus(session, missionTaskId, false);
}

/** KX-73：按事件流重算这项工作的结果指标并写回快照（结束时、每次复核后）。 */
export async function refreshMissionMetrics(organizationId: string, missionTaskId: string): Promise<MissionMetrics | null> {
  const root = await prisma.agentTask.findUnique({ where: { id: missionTaskId }, select: { organizationId: true, createdAt: true, contextSnapshot: true } });
  const snap = root && root.organizationId === organizationId ? readMissionSnapshot(root.contextSnapshot) : null;
  if (!root || !snap) return null;
  const events = await listMissionEventsUnchecked(organizationId, missionTaskId, 0, 1000);
  const modelRuns = await prisma.modelRun.findMany({ where: {
    organizationId,
    OR: [
      { budgetScopeKey: `task:${missionTaskId}` },
      { agentRun: { organizationId, agentTask: { OR: [{ id: missionTaskId }, { parentTaskId: missionTaskId }] } } },
    ],
  }, select: {
    id: true, logicalCallId: true, transportKnown: true, transportStartedAt: true,
    status: true, usageJson: true, durationMs: true, finishedAt: true,
  } });
  const metrics = computeMissionMetrics({
    modelRuns,
    createdAt: root.createdAt,
    outcome: snap.outcome ? { status: snap.outcome.status, finishedAt: snap.outcome.finishedAt } : null,
    state: snap.state,
    contract: snap.contract ?? null,
    events: events.map((e) => ({ type: e.type, actorUserId: e.actorUserId, payload: e.payload })),
  });
  // 只改 metrics 字段：用最新快照合并，避免覆盖并发写入的其它字段。
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AgentTask" WHERE id = ${missionTaskId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const fresh = await tx.agentTask.findUnique({ where: { id: missionTaskId }, select: { contextSnapshot: true } });
    const latest = fresh ? readMissionSnapshot(fresh.contextSnapshot) : null;
    if (!latest) return;
    await tx.agentTask.update({ where: { id: missionTaskId }, data: { contextSnapshot: toJson({ ...latest, metrics }) } });
  });
  return metrics;
}

function missionConversationContent(snap: MissionSnapshot): string {
  if (snap.outcome?.status === "CANCELLED") return "这项工作已按你的要求取消。已完成步骤的结果仍保留在过程面板中。";
  const synth = snap.plan.nodes.find((n) => n.kind === "SYNTHESIS")!;
  const synthState = snap.state.nodes[synth.key];
  const unfinished = snap.plan.nodes.filter((n) => snap.state.nodes[n.key].status !== "SUCCEEDED");
  const label = (key: string) => MISSION_NODE_LABELS[key] ?? key.replace(/^specialist-\d+-/, "");
  const statusText: Record<string, string> = { BLOCKED: "受阻", FAILED: "失败", SKIPPED: "超出预算未执行", PENDING: "未开始", ACTIVE: "进行中" };
  const modelMissing = isModelUnavailableMission(snap);

  let content: string;
  if (snap.outcome?.status === "COMPLETED" && synthState.summary) {
    // KX-54：按条件跳过是计划内的取舍，不算“未完成”，单独说明。
    const byCondition = unfinished.filter((n) => n.kind !== "SYNTHESIS" && conditionSkip(snap.state.nodes[n.key].reason));
    const gaps = unfinished.filter((n) => n.kind !== "SYNTHESIS" && !byCondition.includes(n));
    const notes = [
      gaps.length ? `以下部分未完成，结论中已按 UNKNOWN 处理：${gaps.map((n) => label(n.key)).join("、")}。` : "",
      byCondition.length
        ? `按计划跳过：${byCondition.map((n) => `${label(n.key)}（${conditionSkip(snap.state.nodes[n.key].reason, label)}）`).join("、")}。`
        : "",
    ].filter(Boolean);
    content = notes.length ? `${synthState.summary}\n\n——\n${notes.join("\n")}` : synthState.summary;
  } else if (modelMissing) {
    content = [
      "这项工作我已经拆好了计划，但 Kern 的**模型服务暂时不可用**，团队无法开工，所以我不会给你一个编出来的结论。",
      "",
      "模型服务恢复后（管理员可在「设置 → 模型」查看状态），跟我说“继续”，已拆好的计划会接着推进。",
    ].join("\n");
  } else {
    const lines = unfinished
      .filter((n) => n.kind !== "SYNTHESIS" || ["BLOCKED", "FAILED"].includes(snap.state.nodes[n.key].status))
      .map((n) => {
        const ns = snap.state.nodes[n.key];
        const detail = ["BLOCKED", "FAILED"].includes(ns.status) && ns.summary ? `；${ns.summary.slice(0, 300)}` : "";
        return `- ${label(n.key)}：${conditionSkip(ns.reason, label) ?? statusText[ns.status] ?? ns.status}${detail}`;
      });
    content = [
      "这项工作没能推进到可信结论，需要你介入：",
      ...lines,
      synthState.summary && synthState.status === "SUCCEEDED" ? "\n目前能给出的部分结论：\n" + synthState.summary : "",
    ].filter(Boolean).join("\n");
  }

  return content;
}

async function reportMissionToConversation(session: SessionContext, missionTaskId: string) {
  // Lock and render the current outcome together: retries cannot duplicate a report
  // or publish a stale result after the user has rerun the task.
  const delivered = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AgentTask" WHERE id = ${missionTaskId} AND "organizationId" = ${session.organizationId} FOR UPDATE`;
    const root = await tx.agentTask.findUnique({ where: { id: missionTaskId }, select: { organizationId: true, contextSnapshot: true } });
    const snap = root?.organizationId === session.organizationId ? readMissionSnapshot(root.contextSnapshot) : null;
    if (!snap?.outcome || snap.outcome.messageId || !snap.conversationId) return null;
    const conversation = await tx.conversation.findFirst({
      where: { id: snap.conversationId, organizationId: session.organizationId, ownerId: snap.requestedByUserId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundError("任务的原会话已不可用，暂时无法交付结果");
    const synth = snap.plan.nodes.find(n => n.kind === "SYNTHESIS")!;
    const synthState = snap.state.nodes[synth.key];
    const m = await tx.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: missionConversationContent(snap),
        citations: toJson([
          {
            kind: "kern-mission",
            ref: missionTaskId,
            title: `Kern 工作结果 · ${snap.outcome.status === "COMPLETED" ? "已完成" : snap.outcome.status === "CANCELLED" ? "已取消" : "需要你处理"}`,
            // Completed conclusions are rendered through the ResponseEnvelope (see isMissionConclusionCitation).
            ...(snap.outcome!.status === "COMPLETED" && synthState.summary ? { conclusion: true } : {}),
          },
        ]),
      },
      select: { id: true },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    await tx.agentTask.update({
      where: { id: missionTaskId },
      data: { contextSnapshot: toJson({ ...snap, outcome: { ...snap.outcome, messageId: m.id } }) },
    });
    return { message: m, snapshot: snap, synthState };
  });

  // Learn: a completed mission becomes recall memory for its requester.
  const summary = delivered?.synthState.summary;
  if (delivered && delivered.snapshot.outcome?.status === "COMPLETED" && summary) {
    const { snapshot: snap } = delivered;
    await rememberForUser(
      { organizationId: session.organizationId, userId: snap.requestedByUserId },
      {
        kind: KernMemoryKind.OUTCOME,
        content: `「${snap.plan.goal.slice(0, 60)}」的结论：${summary.replace(/\s+/g, " ").slice(0, 300)}`,
        source: `mission:${missionTaskId}`,
        topics: extractTopics(snap.plan.goal),
      }
    ).catch(() => undefined);
  }
  return delivered?.message;
}

export const MISSION_NODE_LABELS: Record<string, string> = {
  market: "市场与竞品研究",
  compliance: "合规边界",
  economics: "单位经济性",
  opportunity: "机会判断",
  validation: "验证计划",
  gtm: "上市与营销策略",
  "red-team": "红队挑战",
  qa: "独立 QA",
  synthesis: "综合结论",
};

export function isModelUnavailableMission(snap: MissionSnapshot): boolean {
  const blocked = Object.values(snap.state.nodes).filter((n) => n.status === "BLOCKED");
  return blocked.length > 0 &&
    !Object.values(snap.state.nodes).some((n) => n.status === "SUCCEEDED") &&
    blocked.every((n) => (n.reason ?? "").startsWith("MODEL_UNAVAILABLE"));
}

/**
 * Resume a stopped mission (NEEDS_USER) in place: keeps successful nodes,
 * re-dispatches the rest. Returns null when nothing was resumable.
 */
export async function resumeKernMission(
  session: SessionContext,
  missionTaskId: string
): Promise<{ resumed: boolean; reason?: string; resetKeys?: string[] }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      missionTaskId,
      session.organizationId
    );
    const root = await tx.agentTask.findUnique({ where: { id: missionTaskId }, select: { organizationId: true, contextSnapshot: true } });
    if (!root || root.organizationId !== session.organizationId) throw new NotFoundError("Mission not found");
    const snap = readMissionSnapshot(root.contextSnapshot);
    if (!snap || snap.requestedByUserId !== session.userId) throw new NotFoundError("Mission not found");
    if (!snap.outcome) return { resumed: false, reason: "STILL_RUNNING" };
    if (snap.outcome.status === "COMPLETED") return { resumed: false, reason: "ALREADY_COMPLETED" };
    const prepared = prepareMissionResume(snap.plan, snap.state);
    if ("error" in prepared) return { resumed: false, reason: prepared.error };
    const at = new Date().toISOString();
    const next: MissionSnapshot = {
      ...snap,
      plan: prepared.plan,
      state: prepared.state,
      outcome: null,
      log: [...snap.log, { at, event: "MISSION_RESUMED", detail: prepared.resetKeys.join(",") }].slice(-200),
    };
    await tx.agentTask.update({
      where: { id: missionTaskId },
      data: { contextSnapshot: toJson(next), status: AgentTaskStatus.RUNNING, completedAt: null, blockedReason: null },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "KERN_MISSION_RESUMED",
      objectType: "AgentTask",
      objectId: missionTaskId,
      summary: `Kern 继续推进（重跑 ${prepared.resetKeys.length} 个节点）`,
      details: toJson({ resetKeys: prepared.resetKeys }),
    });
    await appendMissionEventsTx(tx, {
      organizationId: session.organizationId,
      missionTaskId,
      demo: !!snap.demo,
      events: [{ type: "mission.resumed", actorUserId: session.userId, payload: { from: "NEEDS_USER", resetKeys: prepared.resetKeys } }],
    });
    return { resumed: true, resetKeys: prepared.resetKeys };
  });
  if (result.resumed) await advanceKernMission(session, missionTaskId);
  return result;
}

/** Latest stopped mission in a conversation (for “继续”). */
export async function findResumableMission(session: SessionContext, conversationId: string) {
  const rows = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId,
      triggerRef: `conversation:${conversationId}`,
      contextSnapshot: { path: ["schemaVersion"], equals: MISSION_SCHEMA },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, contextSnapshot: true },
  });
  const snap = rows[0] ? readMissionSnapshot(rows[0].contextSnapshot) : null;
  return snap?.outcome?.status === "NEEDS_USER" ? rows[0].id : null;
}

export async function getKernMissionStatus(session: SessionContext, missionTaskId: string) {
  return loadMissionStatus(session, missionTaskId, true);
}

/**
 * `ownerOnly=false` is for supervisor-internal callers (worker sessions run
 * as a system user); the org scope is still enforced.
 */
async function loadMissionStatus(session: SessionContext, missionTaskId: string, ownerOnly: boolean) {
  const root = await prisma.agentTask.findUnique({
    where: { id: missionTaskId },
    select: { id: true, organizationId: true, status: true, goal: true, contextSnapshot: true, createdAt: true },
  });
  // Missions are personal (like conversations): only the requester can see them.
  const snap = root && root.organizationId === session.organizationId ? readMissionSnapshot(root.contextSnapshot) : null;
  if (!root || !snap || (ownerOnly && snap.requestedByUserId !== session.userId)) throw new NotFoundError("Mission not found");
  const nodes = snap.plan.nodes.map((n) => ({
    key: n.key,
    kind: n.kind,
    agentCode: n.agentCode,
    status: snap.state.nodes[n.key].status,
    attempts: snap.state.nodes[n.key].attempts,
    taskId: snap.state.nodes[n.key].taskId,
    objective: n.objective,
    dependsOn: n.dependsOn,
    critical: n.critical,
    summary: snap.state.nodes[n.key].summary,
    reason: snap.state.nodes[n.key].reason,
    qa: snap.state.nodes[n.key].qa,
  }));
  const done = nodes.filter((n) => isTerminalNodeStatus(n.status)).length;
  const estimate = estimateMissionProgress(snap.plan, snap.state);
  // KX-73：转定时的门槛需要做法的连续验收次数。
  const playbookRow = snap.playbookRef
    ? await prisma.kernPlaybook.findFirst({ where: { id: snap.playbookRef.id, organizationId: session.organizationId }, select: { name: true, acceptedStreak: true } })
    : null;
  const playbook = playbookRow ? { name: playbookRow.name, acceptedStreak: playbookRow.acceptedStreak } : null;
  // KX-51：未回答的节点提问（任务结束后一律不再显示）。
  const askRows = snap.outcome?.status === "CANCELLED"
    ? []
    : await prisma.kernMissionEvent.findMany({
        where: { organizationId: session.organizationId, missionTaskId, type: { in: ["node.ask", "node.answered"] } },
        orderBy: { seq: "asc" },
        select: { type: true, nodeKey: true, payload: true, createdAt: true },
        take: 200,
      });
  const pendingAsks = computePendingAsks(
    askRows.map((r) => ({ type: r.type, nodeKey: r.nodeKey, payload: (r.payload ?? {}) as Record<string, unknown>, createdAt: r.createdAt.toISOString() }))
  );
  return {
    missionTaskId: root.id,
    status: root.status,
    goal: root.goal,
    playbook: snap.plan.playbook,
    progress: { done, total: nodes.length, pct: estimate.pct, remainingSteps: estimate.remainingSteps, remainingDepth: estimate.remainingDepth },
    revisionRounds: snap.state.revisionRounds,
    tasksCreated: snap.state.tasksCreated,
    budget: snap.plan.budget,
    successCriteria: snap.plan.successCriteria,
    humanGates: snap.plan.humanGates,
    createdAt: root.createdAt.toISOString(),
    nodes,
    outcome: snap.outcome,
    paused: snap.paused ?? null,
    userInputs: snap.userInputs ?? [],
    demo: !!snap.demo,
    memoriesUsed: snap.memoriesUsed ?? [],
    savedPlaybook: snap.playbookRef ?? null,
    contract: snap.contract ?? null,
    metrics: snap.metrics ?? null,
    automation: automationEligibility({ demo: !!snap.demo, playbook, contract: snap.contract ?? null }),
    pendingAsks,
    attention: missionAttention({ outcome: snap.outcome, paused: !!snap.paused, pendingAsks }),
    conversationId: snap.conversationId,
    log: snap.log.slice(-30),
  };
}

/** Recovery sweep for the worker: re-advance RUNNING missions. */
const VERDICT_TEXT: Record<string, string> = { PROHIBITED: "禁止", CONDITIONAL: "有条件可做", CLEAR: "可做" };
/** CONDITION_<node>_<signal> → 「合规判定为禁止」；不是条件跳过返回 null。 */
function conditionSkip(reason: string | null | undefined, label: (k: string) => string = (k) => k): string | null {
  const m = reason ? /^CONDITION_(.+)_(PROHIBITED|CONDITIONAL|CLEAR)$/.exec(reason) : null;
  return m ? `${label(m[1])}判定为${VERDICT_TEXT[m[2]]}` : null;
}

/** KX-31b：审批型提问（连接器写操作）。只给展示用的字段，actionHash 留在服务端事件里。 */
export type PendingApproval = { connector: string; title: string; toolName: string; inputPreview: string };
export type PendingAsk = {
  askId: string;
  nodeKey: string | null;
  question: string;
  defaultAssumption: string;
  askedAt: string;
  timeoutSec: number | null;
  approval?: PendingApproval;
};

/**
 * KX-53 中断帧的读模型：这项任务此刻需要用户做什么（统一给卡片、工作区、顶栏「需要你」）。
 * 只列真正需要人的事：提问、停下待处理、已暂停。
 */
export type MissionAttention = { kind: "ASK" | "NEEDS_USER" | "PAUSED"; text: string; askId?: string; nodeKey?: string | null };
export function missionAttention(input: {
  outcome: { status: string; reasons: string[] } | null;
  paused: boolean;
  pendingAsks: PendingAsk[];
}): MissionAttention[] {
  if (input.outcome?.status === "CANCELLED") return [];
  const out: MissionAttention[] = input.pendingAsks.map((a) => ({ kind: "ASK", text: a.question, askId: a.askId, nodeKey: a.nodeKey }));
  if (input.outcome?.status === "NEEDS_USER") out.push({ kind: "NEEDS_USER", text: "任务停下了，需要你决定怎么继续" });
  if (!input.outcome && input.paused) out.push({ kind: "PAUSED", text: "任务已暂停，等你继续" });
  return out;
}

/** 纯函数：从 node.ask / node.answered 事件算出仍在等回答的提问。 */
export function computePendingAsks(
  events: { type: string; nodeKey: string | null; payload: Record<string, unknown>; createdAt: string }[]
): PendingAsk[] {
  const open = new Map<string, PendingAsk>();
  for (const e of events) {
    const askId = typeof e.payload.askId === "string" ? e.payload.askId : null;
    if (!askId) continue;
    if (e.type === "node.ask") {
      const ap = e.payload.approval as Record<string, unknown> | undefined;
      open.set(askId, {
        askId,
        nodeKey: e.nodeKey,
        question: String(e.payload.question ?? ""),
        defaultAssumption: String(e.payload.defaultAssumption ?? ""),
        askedAt: e.createdAt,
        timeoutSec: typeof e.payload.timeoutSec === "number" ? e.payload.timeoutSec : null,
        ...(ap && typeof ap === "object"
          ? {
              approval: {
                connector: String(ap.connector ?? ""),
                title: String(ap.title ?? ""),
                toolName: String(ap.toolName ?? ""),
                inputPreview: String(ap.inputPreview ?? ""),
              },
            }
          : {}),
      });
    } else if (e.type === "node.answered") open.delete(askId);
  }
  return [...open.values()];
}

export async function listActiveMissionIds(organizationId?: string, limit = 20) {
  const rows = await prisma.agentTask.findMany({
    where: {
      status: AgentTaskStatus.RUNNING,
      contextSnapshot: { path: ["schemaVersion"], equals: MISSION_SCHEMA },
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true },
  });
  // Finished work still needs reconciliation when its conversation receipt is
  // missing. Keep a separate bounded batch so delivery failures cannot starve work.
  const undelivered = await prisma.agentTask.findMany({
    where: {
      status: { in: [AgentTaskStatus.SUCCEEDED, AgentTaskStatus.WAITING_HUMAN, AgentTaskStatus.CANCELLED, AgentTaskStatus.FAILED] },
      availableAt: { lte: new Date() },
      ...(organizationId ? { organizationId } : {}),
      AND: [
        { contextSnapshot: { path: ["schemaVersion"], equals: MISSION_SCHEMA } },
        { contextSnapshot: { path: ["outcome", "messageId"], equals: Prisma.JsonNull } },
        { contextSnapshot: { path: ["conversationId"], not: Prisma.JsonNull } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(limit, 5),
    select: { id: true, organizationId: true },
  });
  return [...rows, ...undelivered];
}
