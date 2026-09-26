import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAttentionSignal,
  planAttention,
  type AttentionSignal,
} from "../src/modules/attention/engine";

const now = new Date("2026-09-26T12:00:00Z");
const sig = (over: Partial<AttentionSignal> & Pick<AttentionSignal, "id" | "kind">): AttentionSignal => ({
  title: over.id,
  occurredAt: now,
  ...over,
});

test("human gates are always HUMAN_GATE and never demoted by budget", () => {
  const signals = Array.from({ length: 10 }, (_, i) =>
    sig({ id: `g${i}`, kind: i % 2 ? "WAITING_HUMAN" : "APPROVAL_REQUEST" })
  );
  const plan = planAttention(signals, { now, budget: { maxInterrupts: 0, maxSurfaced: 0 } });
  assert.equal(plan.counts.HUMAN_GATE, 10);
  assert.equal(plan.visible.length, 10);
  assert.ok(plan.decisions.every((d) => !d.demotedByBudget));
});

test("internal supervision is auto-handled, not a user interruption", () => {
  assert.equal(classifyAttentionSignal(sig({ id: "c", kind: "CHILD_RETURN_REVIEW" }), now).level, "AUTO_HANDLE");
  assert.equal(classifyAttentionSignal(sig({ id: "s", kind: "EVENT_SUPPRESSED" }), now).level, "AUTO_HANDLE");
  assert.equal(classifyAttentionSignal(sig({ id: "r", kind: "TASK_RETRYING" }), now).level, "WATCH");
});

test("protected actions and user requests cannot be silently auto-handled", () => {
  const p = classifyAttentionSignal(sig({ id: "p", kind: "CHILD_RETURN_REVIEW", protectedAction: true }), now);
  assert.equal(p.level, "SURFACE");
  const u = classifyAttentionSignal(sig({ id: "u", kind: "TASK_COMPLETED", userRequested: true }), now);
  assert.equal(u.level, "SURFACE");
});

test("final failures surface; high impact or overdue ones interrupt", () => {
  assert.equal(classifyAttentionSignal(sig({ id: "f", kind: "TASK_FAILED" }), now).level, "SURFACE");
  assert.equal(classifyAttentionSignal(sig({ id: "f2", kind: "TASK_FAILED", impact: 0.9 }), now).level, "INTERRUPT");
  assert.equal(
    classifyAttentionSignal(sig({ id: "d", kind: "DEADLINE_RISK", hoursToDeadline: -1 }), now).level,
    "INTERRUPT"
  );
  assert.equal(
    classifyAttentionSignal(sig({ id: "d2", kind: "DEADLINE_RISK", hoursToDeadline: 12, impact: 0.2 }), now).level,
    "SURFACE"
  );
});

test("decision budget demotes overflow INTERRUPT→SURFACE→WATCH, keeping highest scores", () => {
  const signals = [
    ...Array.from({ length: 4 }, (_, i) => sig({ id: `i${i}`, kind: "TASK_FAILED", impact: 0.7 + i * 0.05 })),
    ...Array.from({ length: 5 }, (_, i) => sig({ id: `s${i}`, kind: "TASK_BLOCKED" })),
  ];
  const plan = planAttention(signals, { now, budget: { maxInterrupts: 2, maxSurfaced: 3 } });
  assert.equal(plan.counts.INTERRUPT, 2);
  assert.equal(plan.counts.SURFACE, 3);
  assert.equal(plan.counts.WATCH, 4);
  const interrupted = plan.decisions.filter((d) => d.level === "INTERRUPT").map((d) => d.signalId);
  assert.deepEqual(interrupted.sort(), ["i2", "i3"]);
  assert.ok(plan.decisions.some((d) => d.reasons.includes("DECISION_BUDGET_DEMOTED")));
  assert.equal(plan.visible[0].decision.level, "INTERRUPT");
});

test("replayed signals are deduplicated by id", () => {
  const plan = planAttention(
    [sig({ id: "x", kind: "TASK_BLOCKED" }), sig({ id: "x", kind: "TASK_BLOCKED" })],
    { now }
  );
  assert.equal(plan.decisions.length, 1);
});
