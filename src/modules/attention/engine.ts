/**
 * Kern Attention Engine · protocol v1 (Architecture V2 §8, §12)
 *
 * Decides, for every signal Kern observes, how much of the user's attention it
 * deserves:
 *
 *   AUTO_HANDLE  Kern handles it internally; never shown by default.
 *   WATCH        Kern keeps monitoring; visible only in the automation center.
 *   SURFACE      Shown in the user's brief, non-blocking.
 *   INTERRUPT    Actively notify the user now (time-sensitive, material).
 *   HUMAN_GATE   Protected decision that only a human may make; always shown,
 *                never dropped by the budget.
 *
 * Principles:
 * - Proactive but restrained: internal supervision work (child returns,
 *   retries, suppressed events) is AUTO_HANDLE / WATCH, not a user task.
 * - Honest: failures are never downgraded below SURFACE when they are final,
 *   UNKNOWN is not treated as success.
 * - Decision Budget: INTERRUPT and SURFACE are capped per window; overflow is
 *   demoted (INTERRUPT → SURFACE → WATCH), HUMAN_GATE is exempt.
 *
 * Pure module: no DB, no clock except the injected `now`.
 */

export type AttentionLevel =
  | "AUTO_HANDLE"
  | "WATCH"
  | "SURFACE"
  | "INTERRUPT"
  | "HUMAN_GATE";

export const ATTENTION_LEVEL_ORDER: AttentionLevel[] = [
  "AUTO_HANDLE",
  "WATCH",
  "SURFACE",
  "INTERRUPT",
  "HUMAN_GATE",
];

export type AttentionSignalKind =
  | "WAITING_HUMAN" //        AgentTask needs a human judgment
  | "POLICY_GATE" //          Autopilot / governance policy requires a human
  | "APPROVAL_REQUEST" //     Gate / DecisionPacket / ApprovalGrant pending
  | "CHILD_RETURN_REVIEW" //  a child task returned to its parent
  | "TASK_FAILED" //          terminal failure after retries
  | "TASK_RETRYING" //        transient failure, backoff scheduled
  | "TASK_BLOCKED" //         honest BLOCKED with missing inputs
  | "TASK_COMPLETED" //       specialist / program finished
  | "EVENT_SUPPRESSED" //     autopilot suppressed an event
  | "EVIDENCE_UNKNOWN" //     key claim remains UNKNOWN
  | "DEADLINE_RISK"; //       due date approaching / slipped

export interface AttentionSignal {
  id: string;
  kind: AttentionSignalKind;
  title: string;
  detail?: string;
  occurredAt: Date | string;
  /** 0..1 — how much the outcome changes business facts / money / launch. */
  impact?: number;
  /** Hours until the item becomes costly; undefined = not time-bound. */
  hoursToDeadline?: number | null;
  /** True when the signal concerns a protected action (gate, budget, launch). */
  protectedAction?: boolean;
  /** True when the user explicitly asked to be told about this. */
  userRequested?: boolean;
  href?: string;
  meta?: Record<string, unknown>;
}

export interface AttentionDecision {
  signalId: string;
  level: AttentionLevel;
  /** Level before the Decision Budget was applied. */
  intendedLevel: AttentionLevel;
  score: number;
  reasons: string[];
  demotedByBudget: boolean;
}

export interface AttentionBudget {
  maxInterrupts: number;
  maxSurfaced: number;
}

export const DEFAULT_ATTENTION_BUDGET: AttentionBudget = {
  maxInterrupts: 2,
  maxSurfaced: 6,
};

const BASE: Record<AttentionSignalKind, { level: AttentionLevel; score: number; reason: string }> = {
  APPROVAL_REQUEST: { level: "HUMAN_GATE", score: 90, reason: "PROTECTED_DECISION" },
  POLICY_GATE: { level: "HUMAN_GATE", score: 85, reason: "POLICY_REQUIRES_HUMAN" },
  WAITING_HUMAN: { level: "HUMAN_GATE", score: 80, reason: "AGENT_WAITING_HUMAN" },
  TASK_FAILED: { level: "SURFACE", score: 60, reason: "TERMINAL_FAILURE" },
  DEADLINE_RISK: { level: "SURFACE", score: 55, reason: "DEADLINE_RISK" },
  TASK_BLOCKED: { level: "SURFACE", score: 45, reason: "BLOCKED_MISSING_INPUTS" },
  EVIDENCE_UNKNOWN: { level: "WATCH", score: 35, reason: "UNKNOWN_KEPT_UNKNOWN" },
  TASK_COMPLETED: { level: "WATCH", score: 25, reason: "RESULT_RETURNED" },
  TASK_RETRYING: { level: "WATCH", score: 20, reason: "TRANSIENT_RETRY" },
  CHILD_RETURN_REVIEW: { level: "AUTO_HANDLE", score: 15, reason: "KERN_INTERNAL_SUPERVISION" },
  EVENT_SUPPRESSED: { level: "AUTO_HANDLE", score: 5, reason: "SUPPRESSED_BY_POLICY" },
};

const rank = (level: AttentionLevel) => ATTENTION_LEVEL_ORDER.indexOf(level);
const maxLevel = (a: AttentionLevel, b: AttentionLevel) => (rank(a) >= rank(b) ? a : b);

/** Classify one signal, before budget. */
export function classifyAttentionSignal(
  signal: AttentionSignal,
  now: Date = new Date()
): Omit<AttentionDecision, "demotedByBudget"> {
  const base = BASE[signal.kind];
  const reasons = [base.reason];
  let level = base.level;
  let score = base.score;

  const impact = Math.max(0, Math.min(1, signal.impact ?? 0));
  score += Math.round(impact * 20);

  if (signal.protectedAction && level !== "HUMAN_GATE") {
    // Anything touching a protected action cannot be silently auto-handled.
    level = maxLevel(level, "SURFACE");
    score += 10;
    reasons.push("PROTECTED_ACTION");
  }

  const h = signal.hoursToDeadline;
  if (typeof h === "number") {
    if (h <= 0) {
      score += 20;
      reasons.push("DEADLINE_PASSED");
      if (level !== "HUMAN_GATE" && rank(level) >= rank("SURFACE")) level = "INTERRUPT";
    } else if (h <= 24) {
      score += 12;
      reasons.push("DEADLINE_WITHIN_24H");
      if (level !== "HUMAN_GATE" && rank(level) >= rank("SURFACE") && impact >= 0.5) {
        level = "INTERRUPT";
      }
    }
  }

  if (signal.kind === "TASK_FAILED" && impact >= 0.7 && level === "SURFACE") {
    level = "INTERRUPT";
    reasons.push("HIGH_IMPACT_FAILURE");
  }

  if (signal.userRequested && rank(level) < rank("SURFACE")) {
    level = "SURFACE";
    score += 10;
    reasons.push("USER_REQUESTED");
  }

  // Freshness: older signals decay slightly so the brief stays current.
  const ageHours = Math.max(
    0,
    (now.getTime() - new Date(signal.occurredAt).getTime()) / 3_600_000
  );
  score -= Math.min(10, Math.floor(ageHours / 12));

  return {
    signalId: signal.id,
    level,
    intendedLevel: level,
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

export interface AttentionPlan {
  version: "kern-attention/v1";
  decisions: AttentionDecision[];
  counts: Record<AttentionLevel, number>;
  budget: AttentionBudget;
  /** Items the user should see, highest priority first. */
  visible: Array<AttentionSignal & { decision: AttentionDecision }>;
}

/** Classify all signals and apply the Decision Budget. */
export function planAttention(
  signals: AttentionSignal[],
  options: { now?: Date; budget?: Partial<AttentionBudget> } = {}
): AttentionPlan {
  const now = options.now ?? new Date();
  const budget = { ...DEFAULT_ATTENTION_BUDGET, ...(options.budget ?? {}) };

  // Deduplicate by id (last write wins) so replayed events don't double-count.
  const byId = new Map<string, AttentionSignal>();
  for (const signal of signals) byId.set(signal.id, signal);

  const ranked = [...byId.values()]
    .map((signal) => ({ signal, d: classifyAttentionSignal(signal, now) }))
    .sort(
      (a, b) =>
        rank(b.d.level) - rank(a.d.level) ||
        b.d.score - a.d.score ||
        new Date(b.signal.occurredAt).getTime() - new Date(a.signal.occurredAt).getTime()
    );

  let interrupts = 0;
  let surfaced = 0;
  const decisions: AttentionDecision[] = [];
  const visible: AttentionPlan["visible"] = [];

  for (const { signal, d } of ranked) {
    let level = d.level;
    if (level === "INTERRUPT") {
      if (interrupts < budget.maxInterrupts) interrupts += 1;
      else level = "SURFACE";
    }
    if (level === "SURFACE") {
      if (surfaced < budget.maxSurfaced) surfaced += 1;
      else level = "WATCH";
    }
    const decision: AttentionDecision = {
      ...d,
      level,
      demotedByBudget: level !== d.level,
      reasons: level !== d.level ? [...d.reasons, "DECISION_BUDGET_DEMOTED"] : d.reasons,
    };
    decisions.push(decision);
    if (rank(level) >= rank("SURFACE")) visible.push({ ...signal, decision });
  }

  const counts = Object.fromEntries(
    ATTENTION_LEVEL_ORDER.map((level) => [level, 0])
  ) as Record<AttentionLevel, number>;
  for (const d of decisions) counts[d.level] += 1;

  return { version: "kern-attention/v1", decisions, counts, budget, visible };
}
