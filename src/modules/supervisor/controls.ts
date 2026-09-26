import { randomUUID } from "node:crypto";
import { AgentTaskStatus, Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import { applyPlanEdit, isTerminalNodeStatus, prepareNodeRerun, type MissionPlanEdit } from "./plan";
import { appendMissionEventsTx, type MissionEventInput } from "./events";
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
  | { action: "add-input"; text: string };

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

    const m = mutate(session, snap, control);
    await tx.agentTask.update({
      where: { id: missionTaskId },
      data: { ...(m.rootData ?? {}), contextSnapshot: toJson(m.next) },
    });
    if (m.cancelChildIds?.length) {
      await tx.agentTask.updateMany({
        where: { id: { in: m.cancelChildIds }, status: AgentTaskStatus.QUEUED },
        data: { status: AgentTaskStatus.CANCELLED, completedAt: new Date(), blockedReason: "Cancelled by user via Kern mission control" },
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

  if (mutation.advance) await advanceKernMission(session, missionTaskId);
  return { ok: true as const, action: control.action, ...mutation.result, mission: await getKernMissionStatus(session, missionTaskId) };
}

/** Pure-ish state transition for a control; throws on an invalid request. */
function mutate(session: SessionContext, snap: MissionSnapshot, control: MissionControl): Mutation {
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
  }
}
