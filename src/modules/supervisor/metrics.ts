/**
 * 结果指标与自动化门槛（KX-73）。纯函数，不碰数据库。
 */
import {
  AUTOMATION_MIN_ACCEPTED,
  MISSION_METRICS_VERSION,
  type AutomationEligibility,
  type MissionMetrics,
  type PlaybookMetrics,
  type TaskContract,
} from "@/modules/kern-contracts";
import type { MissionState } from "./plan";

export interface MetricsEventLike {
  type: string;
  actorUserId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface ModelAttemptFact {
  id: string;
  logicalCallId: string | null;
  transportKnown: boolean;
  transportStartedAt: Date | string | null;
  status: string;
  usageJson: unknown;
  durationMs: number | null;
  finishedAt: Date | string | null;
}

export interface ComputeMetricsInput {
  createdAt: string | Date;
  outcome: { status: "COMPLETED" | "NEEDS_USER" | "CANCELLED"; finishedAt: string } | null;
  state: Pick<MissionState, "revisionRounds" | "reruns">;
  contract?: TaskContract | null;
  events: MetricsEventLike[];
  tokens?: number | null;
  modelRuns?: ModelAttemptFact[];
  now?: Date;
}

/** 用户主动干预的事件类型（需要有 actorUserId）。 */
const INTERVENTION_TYPES = new Set(["mission.paused", "user.input", "plan.edited", "node.rerun", "node.answered", "contract.reviewed"]);

export function computeMissionMetrics(input: ComputeMetricsInput): MissionMetrics {
  let humanInterventions = 0;
  let modelCalls = 0;
  let modelLatencyMs = 0;
  let reviewRejections = 0;
  for (const e of input.events) {
    const p = e.payload ?? {};
    if (e.type === "node.tool" && p.tool === "model_call") {
      modelCalls += 1;
      modelLatencyMs += typeof p.latencyMs === "number" ? p.latencyMs : 0;
      continue;
    }
    if (!e.actorUserId || !INTERVENTION_TYPES.has(e.type)) continue;
    // 打回 / 回答提问引发的连带重跑：干预已经按 contract.reviewed / node.answered 记过一次，不重复计。
    if (e.type === "node.rerun" && (p.reason === "CONTRACT_REJECTED" || p.reason === "USER_ANSWERED")) continue;
    // 复核通过不算干预；打回算。
    if (e.type === "contract.reviewed") {
      if (p.accepted === true) continue;
      reviewRejections += 1;
    }
    humanInterventions += 1;
  }
  const created = new Date(input.createdAt).getTime();
  const finished = input.outcome ? new Date(input.outcome.finishedAt).getTime() : null;
  const contract = input.contract ?? null;
  const accepted = !contract ? null : contract.reviews.length === 0 ? null : contract.acceptance.every((c) => c.status === "PASS");
  return {
    version: MISSION_METRICS_VERSION,
    completed: input.outcome?.status === "COMPLETED",
    accepted,
    humanInterventions,
    reworkRounds: (input.state.revisionRounds ?? 0) + (input.state.reruns ?? 0) + reviewRejections,
    timeToResultMs: finished !== null && Number.isFinite(created) ? Math.max(0, finished - created) : null,
    cost: input.modelRuns ? costFromModelRuns(input.modelRuns) : {
      modelCalls, modelLatencyMs, tokens: input.tokens ?? null,
      logicalCalls: modelCalls, actualAttempts: null, successfulAttempts: null,
    },
    computedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Ledger facts include failed retries. Unknown transport or missing usage stays unknown. */
export function costFromModelRuns(rows: ModelAttemptFact[]): MissionMetrics["cost"] {
  const actual = rows.filter((row) => row.transportKnown && row.transportStartedAt !== null);
  const unknown = rows.filter((row) => !row.transportKnown).length;
  let knownTokens = 0;
  let completeUsage = unknown === 0;
  let latencyMs = 0;
  for (const row of actual) {
    const usage = row.usageJson && typeof row.usageJson === "object" && !Array.isArray(row.usageJson)
      ? row.usageJson as Record<string, unknown> : {};
    const valid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const total = valid(usage.totalTokens) ? usage.totalTokens
      : valid(usage.inputTokens) && valid(usage.outputTokens) ? usage.inputTokens + usage.outputTokens : null;
    if (total === null || !Number.isSafeInteger(total)) completeUsage = false;
    else knownTokens += total;
    if (row.finishedAt) {
      const duration = new Date(row.finishedAt).getTime() - new Date(row.transportStartedAt!).getTime();
      if (Number.isFinite(duration)) latencyMs += Math.max(0, duration);
    }
  }
  const knownLogicalCalls = new Set(rows.flatMap(row => row.logicalCallId ? [row.logicalCallId] : [])).size;
  return {
    modelCalls: knownLogicalCalls,
    logicalCalls: rows.every(row => row.logicalCallId !== null) ? knownLogicalCalls : null,
    modelLatencyMs: latencyMs,
    tokens: completeUsage ? knownTokens : null,
    actualAttempts: unknown ? null : actual.length,
    successfulAttempts: unknown ? null : actual.filter(row => row.status === "SUCCEEDED").length,
    admittedAttempts: rows.length, unknownTransportAttempts: unknown, knownTokens,
  };
}

function avg(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

/** 做法维度汇总：只统计非演示、已结束的任务。 */
export function aggregatePlaybookMetrics(runs: MissionMetrics[], acceptedStreak: number): PlaybookMetrics {
  const done = runs.filter((m) => m.timeToResultMs !== null);
  return {
    runs: runs.length,
    completed: runs.filter((m) => m.completed).length,
    accepted: runs.filter((m) => m.accepted === true).length,
    acceptedStreak,
    avgHumanInterventions: avg(done.map((m) => m.humanInterventions)),
    avgReworkRounds: avg(done.map((m) => m.reworkRounds)),
    avgTimeToResultMs: avg(done.map((m) => m.timeToResultMs as number)),
    avgModelCalls: avg(done.flatMap((m) => typeof m.cost.actualAttempts === "number" ? [m.cost.actualAttempts] : [])),
  };
}

/**
 * 三次成功才自动化：一项工作要转成定时，必须
 * ① 不是演示；② 按某个做法跑的；③ 这次契约已全部通过；④ 该做法连续验收通过 ≥ AUTOMATION_MIN_ACCEPTED 次。
 */
export function automationEligibility(input: {
  demo: boolean;
  playbook: { name: string; acceptedStreak: number } | null;
  contract: TaskContract | null;
  required?: number;
}): AutomationEligibility {
  const required = input.required ?? AUTOMATION_MIN_ACCEPTED;
  const streak = input.playbook?.acceptedStreak ?? 0;
  const deny = (reason: string) => ({ allowed: false, reason, streak, required });
  if (input.demo) return deny("演示运行不能转定时。");
  if (!input.playbook) return deny(`先把这次工作保存为做法；做法连续 ${required} 次验收通过后才能转定时。`);
  if (!input.contract || input.contract.reviews.length === 0 || !input.contract.acceptance.every((c) => c.status === "PASS")) {
    return deny("先在验收清单里复核通过这次的结果。");
  }
  if (streak < required) {
    return deny(`做法「${input.playbook.name}」已连续验收通过 ${streak} 次，还差 ${required - streak} 次才能转定时。`);
  }
  return { allowed: true, reason: null, streak, required };
}
