import { randomUUID } from "node:crypto";
import { AgentTaskStatus, Prisma, KernMemoryKind } from "@prisma/client";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import { applyPlanEdit, isTerminalNodeStatus, prepareNodeRerun, rejectionRerunRoot, type MissionPlanEdit } from "./plan";
import { applyContractReview, contractAccepted, reviewFeedback, type ReviewVerdict } from "./contract";
import { recordPlaybookAcceptance } from "@/modules/playbooks/service";
import { refreshMissionMetrics } from "./service";
import { appendMissionEventsTx, type MissionEventInput } from "./events";
import { rememberForUser, extractTopics } from "@/modules/memory";
import { AppError } from "@/shared/errors";
import { connectorApprovalService } from "@/modules/connectors";
import {
  advanceKernMission,
  getKernMissionStatus,
  readMissionSnapshot,
  resumeKernMission,
  toJson,
  type MissionSnapshot,
} from "./service";

/**
 * User interventions on a running mission
 * =======================================
 *
 * pause / resume / cancel / skip / rerun / edit-plan / add-input.
 * Owner-only (missions are personal, like conversations). Each control runs
 * under the same root row lock as `advanceKernMission`, writes an audit event
 * and a mission event, then lets the supervisor take the next step.
 */

export type MissionControl =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "cancel" }
  | { action: "skip"; nodeKey: string }
  | { action: "rerun"; nodeKey: string; feedback?: string }
  | { action: "edit-plan"; edits: MissionPlanEdit[] }
  | { action: "add-input"; text: string }
  | { action: "answer"; askId: string; mode: "answer" | "ignore" | "abort"; text?: string }
  | { action: "approve"; askId: string; allow: boolean }
  /** KX-72：按条复核契约；有打回项则带意见重跑综合结论。 */
  | { action: "review"; verdicts: ReviewVerdict[] };

export function parseMissionControl(body: unknown): MissionControl {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  switch (b.action) {
    case "pause":
    case "resume":
    case "cancel":
      return { action: b.action };
    case "skip": {
      const nodeKey = str(b.nodeKey, 60);
      if (!nodeKey) break;
      return { action: "skip", nodeKey };
    }
    case "rerun": {
      const nodeKey = str(b.nodeKey, 60);
      if (!nodeKey) break;
      return { action: "rerun", nodeKey, feedback: str(b.feedback, 2000) || undefined };
    }
    case "edit-plan":
      if (!Array.isArray(b.edits) || !b.edits.length || b.edits.length > 12) break;
      return { action: "edit-plan", edits: b.edits as MissionPlanEdit[] };
    case "add-input": {
      const text = str(b.text, 4000);
      if (!text) break;
      return { action: "add-input", text };
    }
    case "answer": {
      const askId = str(b.askId, 100);
      const mode = b.mode === "answer" || b.mode === "ignore" || b.mode === "abort" ? b.mode : null;
      const text = str(b.text, 2000);
      if (!askId || !mode || (mode === "answer" && !text)) break;
      return { action: "answer", askId, mode, text: mode === "answer" ? text : undefined };
    }
    case "approve": {
      const askId = str(b.askId, 100);
      if (!askId || typeof b.allow !== "boolean") break;
      return { action: "approve", askId, allow: b.allow };
    }
    case "review": {
      if (!Array.isArray(b.verdicts) || b.verdicts.length > 40) break;
      const verdicts: ReviewVerdict[] = [];
      for (const raw of b.verdicts) {
        const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const id = str(v.id, 60);
        if (!id || typeof v.pass !== "boolean") break;
        verdicts.push({ id, pass: v.pass, note: str(v.note, 500) || null });
      }
      if (verdicts.length !== b.verdicts.length) break;
      return { action: "review", verdicts };
    }
  }
  throw new UnprocessableEntityError("Invalid mission control");
}

const AUDIT_ACTION: Record<MissionControl["action"], string> = {
  pause: "KERN_MISSION_PAUSED",
  resume: "KERN_MISSION_RESUMED",
  cancel: "KERN_MISSION_CANCELLED",
  skip: "KERN_MISSION_NODE_SKIPPED",
  rerun: "KERN_MISSION_NODE_RERUN",
  "edit-plan": "KERN_MISSION_PLAN_EDITED",
  "add-input": "KERN_MISSION_USER_INPUT",
  answer: "KERN_MISSION_NODE_ANSWERED",
  approve: "KERN_MISSION_CONNECTOR_APPROVAL",
  review: "KERN_MISSION_CONTRACT_REVIEWED",
};

interface Mutation {
  next: MissionSnapshot;
  rootData?: Prisma.AgentTaskUpdateInput;
  cancelChildIds?: string[];
  events: MissionEventInput[];
  summary: string;
  advance: boolean;
  result: Record<string, unknown>;
}

export type MissionControlResult = {
  ok: true;
  action: MissionControl["action"];
  mission: Awaited<ReturnType<typeof getKernMissionStatus>>;
  [detail: string]: unknown;
};

export async function controlKernMission(
  session: SessionContext,
  missionTaskId: string,
  control: MissionControl
): Promise<MissionControlResult> {
  // "resume" on a stopped (NEEDS_USER) mission is the existing resume path.
  if (control.action === "resume") {
    const status = await getKernMissionStatus(session, missionTaskId);
    if (!status.paused && status.outcome?.status === "NEEDS_USER") {
      const r = await resumeKernMission(session, missionTaskId);
      if (!r.resumed) throw new ConflictError(`Cannot resume: ${r.reason}`);
      return { ok: true as const, action: control.action, ...r, mission: await getKernMissionStatus(session, missionTaskId) };
    }
  }

  let answeredAsk: AskRef | undefined;
  const mutation = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      missionTaskId,
      session.organizationId
    );
    const root = await tx.agentTask.findUnique({
      where: { id: missionTaskId },
      select: { organizationId: true, status: true, contextSnapshot: true },
    });
    const snap = root && root.organizationId === session.organizationId ? readMissionSnapshot(root.contextSnapshot) : null;
    if (!root || !snap || snap.requestedByUserId !== session.userId) throw new NotFoundError("Mission not found");

    // KX-51b：回答必须对应一个存在且未回答的提问。
    let ask: AskRef | undefined;
    let effective: MissionControl = control;
    let approvedEvent: MissionEventInput | null = null;
    if (control.action === "answer" || control.action === "approve") {
      const evs = await tx.kernMissionEvent.findMany({
        where: {
          organizationId: session.organizationId,
          missionTaskId,
          type: { in: ["node.ask", "node.answered"] },
          payload: { path: ["askId"], equals: control.askId },
        },
        select: { type: true, nodeKey: true, payload: true },
      });
      const asked = evs.find((e) => e.type === "node.ask");
      if (!asked) throw new NotFoundError("Question not found");
      if (evs.some((e) => e.type === "node.answered")) throw new ConflictError("Question already answered");
      const p = (asked.payload ?? {}) as Record<string, unknown>;
      ask = { nodeKey: asked.nodeKey, question: String(p.question ?? "") };
      answeredAsk = ask;
      // KX-31b：审批型提问只能用 approve 处理，普通提问不能用 approve。
      const approval = p.approval as Record<string, unknown> | undefined;
      if (control.action === "answer" && approval) throw new UnprocessableEntityError("This is an approval request; use approve");
      if (control.action === "approve") {
        if (!approval) throw new UnprocessableEntityError("Not an approval request");
        const title = `${String(approval.connector ?? "")} · ${String(approval.title ?? "")}`;
        let grantId: string | null = null;
        if (control.allow) {
          const svc = connectorApprovalService();
          if (!svc) throw new AppError("审批服务未配置（PM_OS_APPROVAL_HMAC_SECRET）", "APPROVAL_NOT_CONFIGURED", 503);
          const grant = await svc.issue(session, {
            taskRef: missionTaskId,
            capability: String(approval.capability ?? ""),
            resource: String(approval.resource ?? ""),
            actionHash: String(approval.actionHash ?? ""),
            validUntil: new Date(Date.now() + 60 * 60 * 1000),
            channel: "kern-mission",
          });
          grantId = grant.id;
        }
        const text = control.allow
          ? `允许一次「${title}」。请用完全相同的输入再调用一次 ${String(approval.toolName ?? "")}：${String(approval.inputJson ?? approval.inputPreview ?? "{}")}，然后完成这一步。`
          : `不允许「${title}」。不要再尝试这个操作，在结论里写明用户未批准。`;
        effective = control.allow
          ? { action: "answer", askId: control.askId, mode: "answer", text }
          : { action: "answer", askId: control.askId, mode: "ignore" };
        approvedEvent = {
          type: "node.answered",
          payload: { askId: control.askId, mode: control.allow ? "answer" : "ignore", decision: control.allow ? "allow" : "deny", text: title, grantId },
        };
      }
    }
    const inner = mutate(session, snap, effective, ask);
    const m: Mutation = approvedEvent
      ? {
          ...inner,
          events: [approvedEvent, ...inner.events.filter((e) => e.type !== "node.answered")],
          summary: control.action === "approve" && control.allow ? `用户允许了一次连接器写操作；${inner.summary}` : "用户没有允许连接器写操作",
        }
      : inner;
    await tx.agentTask.update({
      where: { id: missionTaskId },
      data: { ...(m.rootData ?? {}), contextSnapshot: toJson(m.next) },
    });
    if (m.cancelChildIds?.length) {
      const cancelled = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "AgentTask" SET status = 'CANCELLED', "completedAt" = now(),
          "blockedReason" = 'Cancelled by user via Kern mission control',
          "contextSnapshot" = COALESCE("contextSnapshot", '{}'::jsonb) - 'executorLease'
        WHERE id = ANY(${m.cancelChildIds}::text[]) AND "organizationId" = ${session.organizationId}
          AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') RETURNING id
      `;
      await tx.agentRun.updateMany({
        where: { agentTaskId: { in: cancelled.map(t => t.id) }, status: { in: ["QUEUED", "RUNNING", "WAITING_CONFIRMATION"] } },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date(), errorReason: "用户取消了任务或该步骤已被替换" },
      });
    }
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: AUDIT_ACTION[control.action],
      objectType: "AgentTask",
      objectId: missionTaskId,
      summary: m.summary,
      details: toJson({ control }),
    });
    await appendMissionEventsTx(tx, {
      organizationId: session.organizationId,
      missionTaskId,
      demo: !!snap.demo,
      events: m.events.map((e) => ({ ...e, actorUserId: session.userId })),
    });
    return m;
  });

  // KX-73：复核结束后刷新指标；通过且按做法跑的，做法连续验收 +1（演示不计）。
  if (control.action === "review") {
    const next = mutation.next;
    if (mutation.result.accepted === true && next.playbookRef && !next.demo) await recordPlaybookAcceptance(next.playbookRef.id).catch(() => undefined);
    // KX-74：打回意见沉淀为「纠正」记忆（程序性记忆），下次同类工作先看；演示不记。
    if (!next.demo) {
      const goalTopics = extractTopics(next.plan.goal);
      for (const v of control.verdicts) {
        if (v.pass || !v.note?.trim()) continue;
        const item = next.contract?.acceptance.find((c) => c.id === v.id);
        await rememberForUser(session, {
          kind: KernMemoryKind.CORRECTION,
          content: `做「${next.plan.goal.slice(0, 40)}」这类工作时：${v.note.trim().slice(0, 200)}${item ? `（针对「${item.text.slice(0, 40)}」）` : ""}`,
          source: `mission:${missionTaskId}:correction:${v.id}`,
          topics: goalTopics,
        }).catch(() => undefined);
      }
    }
    await refreshMissionMetrics(session.organizationId, missionTaskId).catch(() => undefined);
  }

  // KX-51b：回答沉淀为记忆（类似「总是允许」），同类问题下次不必再问；失败（如额度满）不影响回答本身。
  if (control.action === "answer" && control.mode === "answer" && control.text && answeredAsk?.question) {
    try {
      await rememberForUser(session, {
        kind: "FACT",
        content: `${answeredAsk.question} → ${control.text}`,
        source: `mission-ask:${control.askId}`,
      });
    } catch {
      /* 记忆写入失败不影响任务 */
    }
  }
  if (mutation.advance) await advanceKernMission(session, missionTaskId);
  return { ok: true as const, action: control.action, ...mutation.result, mission: await getKernMissionStatus(session, missionTaskId) };
}

/** Pure-ish state transition for a control; throws on an invalid request. */
type AskRef = { nodeKey: string | null; question: string };

function mutate(session: SessionContext, snap: MissionSnapshot, control: MissionControl, ask?: AskRef): Mutation {
  const at = new Date().toISOString();
  const running = !snap.outcome;
  const log = (event: string, detail?: string) => [...snap.log, { at, event, detail }].slice(-200);
  const requireRunning = () => {
    if (!running) throw new ConflictError(`Mission already finished (${snap.outcome!.status})`);
  };

  switch (control.action) {
    case "pause": {
      requireRunning();
      if (snap.paused) throw new ConflictError("Mission already paused");
      const active = Object.entries(snap.state.nodes).filter(([, n]) => n.status === "ACTIVE").map(([k]) => k);
      return {
        next: { ...snap, paused: { at, byUserId: session.userId }, log: log("MISSION_PAUSED") },
        events: [{ type: "mission.paused", payload: { activeNodeKeys: active } }],
        summary: "用户暂停了 Kern 任务（进行中的步骤会做完，不再派发新步骤）",
        advance: false,
        result: { activeNodeKeys: active },
      };
    }
    case "resume": {
      requireRunning();
      if (!snap.paused) throw new ConflictError("Mission is not paused");
      return {
        next: { ...snap, paused: null, log: log("MISSION_UNPAUSED") },
        events: [{ type: "mission.resumed", payload: { from: "PAUSED" } }],
        summary: "用户继续了 Kern 任务",
        advance: true,
        result: {},
      };
    }
    case "cancel": {
      requireRunning();
      const state = JSON.parse(JSON.stringify(snap.state)) as MissionSnapshot["state"];
      const cancelChildIds: string[] = [];
      const skipped: string[] = [];
      for (const [key, ns] of Object.entries(state.nodes)) {
        if (ns.status === "ACTIVE" && ns.taskId) cancelChildIds.push(ns.taskId);
        if (!isTerminalNodeStatus(ns.status)) {
          ns.status = "SKIPPED";
          ns.reason = "MISSION_CANCELLED";
          skipped.push(key);
        }
      }
      return {
        next: {
          ...snap,
          state,
          paused: null,
          outcome: { status: "CANCELLED", reasons: ["USER_CANCELLED"], messageId: null, finishedAt: at },
          log: log("MISSION_CANCELLED"),
        },
        rootData: { status: AgentTaskStatus.CANCELLED, completedAt: new Date(), blockedReason: null },
        cancelChildIds,
        events: [
          ...skipped.map((k) => ({ type: "node.skipped" as const, nodeKey: k, payload: { reason: "MISSION_CANCELLED" } })),
          { type: "mission.cancelled", payload: { skipped } },
        ],
        summary: `用户取消了 Kern 任务（${skipped.length} 个步骤未完成）`,
        advance: false,
        result: { skipped },
      };
    }
    case "skip": {
      requireRunning();
      const node = snap.plan.nodes.find((n) => n.key === control.nodeKey);
      const ns = snap.state.nodes[control.nodeKey];
      if (!node || !ns) throw new NotFoundError("Step not found");
      if (node.kind === "SYNTHESIS") throw new UnprocessableEntityError("The synthesis step cannot be skipped; cancel instead");
      if (isTerminalNodeStatus(ns.status)) throw new ConflictError(`Step already ${ns.status}`);
      const state = JSON.parse(JSON.stringify(snap.state)) as MissionSnapshot["state"];
      const cancelChildIds = ns.status === "ACTIVE" && ns.taskId ? [ns.taskId] : [];
      state.nodes[node.key] = { ...state.nodes[node.key], status: "SKIPPED", reason: "USER_SKIPPED" };
      return {
        next: { ...snap, state, log: log("NODE_SKIPPED", `${node.key}:USER_SKIPPED`) },
        cancelChildIds,
        events: [
          {
            type: "node.skipped",
            nodeKey: node.key,
            payload: { reason: "USER_SKIPPED", critical: node.critical, wasActive: cancelChildIds.length > 0 },
          },
        ],
        summary: `用户跳过了步骤 ${node.key}${node.critical ? "（关键步骤：结论会标记为需要你确认）" : ""}`,
        advance: true,
        result: { critical: node.critical },
      };
    }
    case "rerun": {
      if (snap.outcome?.status === "CANCELLED") throw new ConflictError("Mission was cancelled");
      if (snap.paused) throw new ConflictError("Mission is paused; resume first");
      const feedback = control.feedback ? `（用户要求重跑）${control.feedback}` : "（用户要求重跑该步骤，请重新核实并补强）";
      const prepared = prepareNodeRerun(snap.plan, snap.state, control.nodeKey, feedback);
      if ("error" in prepared) throw new ConflictError(`Cannot rerun: ${prepared.error}`);
      const reopened = !!snap.outcome;
      return {
        next: { ...snap, plan: prepared.plan, state: prepared.state, outcome: null, log: log("NODE_RERUN", prepared.resetKeys.join(",")) },
        rootData: reopened ? { status: AgentTaskStatus.RUNNING, completedAt: null, blockedReason: null } : undefined,
        events: [
          { type: "node.rerun", nodeKey: control.nodeKey, payload: { resetKeys: prepared.resetKeys, feedback: control.feedback ?? null, reopened } },
        ],
        summary: `用户要求重跑 ${control.nodeKey}（连带 ${prepared.resetKeys.length - 1} 个下游步骤）`,
        advance: true,
        result: { resetKeys: prepared.resetKeys, reopened },
      };
    }
    case "edit-plan": {
      requireRunning();
      const edited = applyPlanEdit(snap.plan, snap.state, control.edits);
      if ("error" in edited) throw new UnprocessableEntityError(`Cannot edit plan: ${edited.error}`);
      return {
        next: { ...snap, plan: edited.plan, state: edited.state, log: log("PLAN_EDITED", edited.summary.join("; ")) },
        events: [
          {
            type: "plan.edited",
            payload: {
              changes: edited.summary,
              edits: control.edits,
              nodes: edited.plan.nodes.map((n) => ({ key: n.key, kind: n.kind, agentCode: n.agentCode, objective: n.objective, dependsOn: n.dependsOn, critical: n.critical })),
            },
          },
        ],
        summary: `用户调整了计划：${edited.summary.join("；")}`.slice(0, 500),
        advance: true,
        result: { changes: edited.summary },
      };
    }
    case "add-input": {
      requireRunning();
      const input = { id: randomUUID(), at, text: control.text, appliedTo: [] as string[] };
      const userInputs = [...(snap.userInputs ?? []), input].slice(-20);
      const pending = snap.plan.nodes.filter((n) => snap.state.nodes[n.key]?.status === "PENDING").map((n) => n.key);
      return {
        next: { ...snap, userInputs, log: log("USER_INPUT", input.id) },
        events: [{ type: "user.input", payload: { inputId: input.id, text: input.text, willApplyTo: pending } }],
        summary: `用户补充了信息（将带入 ${pending.length} 个后续步骤）`,
        advance: true,
        result: { inputId: input.id, willApplyTo: pending },
      };
    }
    case "answer": {
      if (snap.outcome?.status === "CANCELLED") throw new ConflictError("Mission was cancelled");
      const answered = {
        type: "node.answered" as const,
        payload: { askId: control.askId, mode: control.mode, text: control.text ?? null },
      };
      if (control.mode === "abort") {
        requireRunning();
        const cancel = mutate(session, snap, { action: "cancel" });
        return { ...cancel, events: [answered, ...cancel.events], summary: `用户在提问处中止了任务；${cancel.summary}` };
      }
      if (control.mode === "ignore" || !control.text) {
        return {
          next: { ...snap, log: log("NODE_ANSWERED", `${control.askId}:ignore`) },
          events: [answered],
          summary: "用户确认按默认假设继续",
          advance: false,
          result: { askId: control.askId, mode: control.mode, applied: "none" },
        };
      }
      // 回答：以用户回答为准重做提问的那一步（非阻塞提问的收口）。
      const nodeKey = ask?.nodeKey ?? null;
      const feedback = `用户回答了你之前的提问「${ask?.question ?? ""}」：${control.text}。以用户回答为准重做这一步，不再使用默认假设。`;
      const ns = nodeKey ? snap.state.nodes[nodeKey] : undefined;
      if (nodeKey && ns?.status === "ACTIVE") {
        // 还在跑：作废当前这次执行，带着回答重新派发（旧结果在 reconcile 时因 taskId 不匹配被忽略）。
        const state = JSON.parse(JSON.stringify(snap.state)) as MissionSnapshot["state"];
        state.nodes[nodeKey] = { ...state.nodes[nodeKey], status: "PENDING", taskId: null, summary: null, reason: null, qa: null, revisionFeedback: feedback };
        return {
          next: { ...snap, state, log: log("NODE_ANSWERED", `${control.askId}:rerun-active`) },
          cancelChildIds: ns.taskId ? [ns.taskId] : [],
          events: [answered, { type: "node.rerun", nodeKey, payload: { resetKeys: [nodeKey], feedback, reason: "USER_ANSWERED", reopened: false } }],
          summary: `用户回答了提问，「${nodeKey}」带着回答重做`,
          advance: true,
          result: { askId: control.askId, mode: control.mode, applied: "rerun", resetKeys: [nodeKey] },
        };
      }
      if (nodeKey && ns && isTerminalNodeStatus(ns.status) && !snap.paused) {
        const prepared = prepareNodeRerun(snap.plan, snap.state, nodeKey, feedback);
        if (!("error" in prepared)) {
          const reopened = !!snap.outcome;
          return {
            next: { ...snap, plan: prepared.plan, state: prepared.state, outcome: null, log: log("NODE_ANSWERED", `${control.askId}:rerun`) },
            rootData: reopened ? { status: AgentTaskStatus.RUNNING, completedAt: null, blockedReason: null } : undefined,
            events: [answered, { type: "node.rerun", nodeKey, payload: { resetKeys: prepared.resetKeys, feedback, reason: "USER_ANSWERED", reopened } }],
            summary: `用户回答了提问，重做「${nodeKey}」（连带 ${prepared.resetKeys.length - 1} 个下游步骤）`,
            advance: true,
            result: { askId: control.askId, mode: control.mode, applied: "rerun", resetKeys: prepared.resetKeys, reopened },
          };
        }
      }
      // 兜底（重跑次数用完 / 下游正在跑 / 已暂停）：作为补充信息带入后续步骤。
      const input = { id: randomUUID(), at, text: `${ask?.question ?? ""} → ${control.text}`, appliedTo: [] as string[] };
      const pending = snap.plan.nodes.filter((n) => snap.state.nodes[n.key]?.status === "PENDING").map((n) => n.key);
      return {
        next: { ...snap, userInputs: [...(snap.userInputs ?? []), input].slice(-20), log: log("NODE_ANSWERED", `${control.askId}:input`) },
        events: [answered, { type: "user.input", payload: { inputId: input.id, text: input.text, willApplyTo: pending } }],
        summary: `用户回答了提问（将带入 ${pending.length} 个后续步骤）`,
        advance: running,
        result: { askId: control.askId, mode: control.mode, applied: "input", willApplyTo: pending },
      };
    }
    case "approve":
      // controlKernMission 先把 approve 换算成 answer 再调用 mutate，这里不会走到。
      throw new UnprocessableEntityError("approve must be translated before mutate");
    case "review": {
      if (!snap.contract) throw new ConflictError("This mission has no contract to review");
      if (snap.outcome?.status !== "COMPLETED") throw new ConflictError("Review is only possible after the mission completed");
      const reviewed = applyContractReview(snap.contract, control.verdicts, { userId: session.userId, at });
      const round = reviewed.contract.reviews.length;
      const base = {
        type: "contract.reviewed" as const,
        payload: { round, rejected: reviewed.rejected.map((c) => ({ id: c.id, text: c.text, note: c.note })), accepted: reviewed.rejected.length === 0 },
      };
      if (!reviewed.rejected.length) {
        return {
          next: { ...snap, contract: reviewed.contract, log: log("CONTRACT_ACCEPTED", `round ${round}`) },
          events: [base],
          summary: `用户复核通过（第 ${round} 轮），契约成立`,
          advance: false,
          result: { accepted: contractAccepted(reviewed.contract), round, rejected: [] },
        };
      }
      // 有打回：从「被打回的那条真正怪罪的节点」重跑（连带下游），任务重新打开。
      // 只重跑综合结论的话，QA 的 FAIL 结论原样保留，auto:qa-pass 永远过不了（窗口 B 实测）。
      const synth = snap.plan.nodes.find((n) => n.kind === "SYNTHESIS");
      const rerunKey = rejectionRerunRoot(snap.plan, snap.state, reviewed.rejected.map((c) => c.id)) ?? synth?.key ?? null;
      const prepared = rerunKey ? prepareNodeRerun(snap.plan, snap.state, rerunKey, reviewFeedback(reviewed.rejected)) : { error: "NO_SYNTHESIS" as const };
      if ("error" in prepared) {
        // 重跑不了（次数用完等）：只记录复核结果，让用户看到哪些没过。
        return {
          next: { ...snap, contract: reviewed.contract, log: log("CONTRACT_REJECTED", `round ${round}:${prepared.error}`) },
          events: [base],
          summary: `用户打回 ${reviewed.rejected.length} 条，但无法重跑（${prepared.error}）`,
          advance: false,
          result: { accepted: false, round, rejected: reviewed.rejected.map((c) => c.id), rerun: null, error: prepared.error },
        };
      }
      // 重跑后：自动项回到待检查；被打回的人工项回到待复核（保留意见，下一轮用户再判）。
      const contract = {
        ...reviewed.contract,
        acceptance: reviewed.contract.acceptance.map((c) =>
          c.check === "auto" ? { ...c, status: "PENDING" as const, note: null } : c.status === "FAIL" ? { ...c, status: "PENDING" as const } : c
        ),
      };
      return {
        next: { ...snap, plan: prepared.plan, state: prepared.state, outcome: null, contract, log: log("CONTRACT_REJECTED", `round ${round}:${reviewed.rejected.map((c) => c.id).join(",")}`) },
        rootData: { status: AgentTaskStatus.RUNNING, completedAt: null, blockedReason: null },
        events: [base, { type: "node.rerun", nodeKey: rerunKey!, payload: { resetKeys: prepared.resetKeys, feedback: reviewFeedback(reviewed.rejected), reason: "CONTRACT_REJECTED", reopened: true } }],
        summary: `用户打回 ${reviewed.rejected.length} 条完成标准，从「${rerunKey}」起按意见重做`,
        advance: true,
        result: { accepted: false, round, rejected: reviewed.rejected.map((c) => c.id), rerun: prepared.resetKeys },
      };
    }
  }
}
