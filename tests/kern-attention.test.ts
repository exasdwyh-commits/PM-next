import assert from "node:assert/strict";
import test from "node:test";
import { buildAttentionBrief } from "../src/modules/supervisor/attention";

const mission = (status: "RUNNING" | "COMPLETED" | "NEEDS_USER", seenByUser = false) => ({
  kind: "MISSION" as const, id: status + seenByUser, goal: "g", status,
  progress: { done: 3, total: 9 }, reasons: status === "NEEDS_USER" ? ["CRITICAL_market_BLOCKED"] : [],
  finishedAt: null, conversationId: "c", seenByUser,
});

test("restraint: running work is not pushed; blocked missions interrupt first", () => {
  const brief = buildAttentionBrief([
    mission("RUNNING"),
    mission("COMPLETED", true),
    mission("COMPLETED", false),
    mission("NEEDS_USER"),
    { kind: "PROPOSAL", id: "p", title: "改字段", actionType: "UPDATE_FIELD", createdAt: "", conversationId: null },
  ]);
  assert.equal(brief.inProgress.length, 1);
  assert.equal(brief.handledQuietly, 1);
  assert.deepEqual(brief.needsYou.map((i) => i.level), ["INTERRUPT", "SURFACE", "SURFACE"]);
  assert.match(brief.needsYou[0].why, /关键环节/);
});

test("protected proposals escalate to INTERRUPT", () => {
  const brief = buildAttentionBrief([
    { kind: "PROPOSAL", id: "p", title: "发布", actionType: "PUBLISH_LISTING", createdAt: "", conversationId: null },
  ]);
  assert.equal(brief.needsYou[0].level, "INTERRUPT");
});

test("deadlines: overdue/blocked interrupt, due soon surfaces, far away is watched", () => {
  const now = "2026-09-26T02:00:00.000Z";
  const d = (days: number) => new Date(Date.parse(now) + days * 86_400_000).toISOString();
  const b = buildAttentionBrief([
    { kind: "DEADLINE", id: "a", title: "逾期", dueAt: d(-2), blocked: false, href: null, now },
    { kind: "DEADLINE", id: "b", title: "明天", dueAt: d(1), blocked: false, href: null, now },
    { kind: "DEADLINE", id: "c", title: "远", dueAt: d(10), blocked: false, href: null, now },
    { kind: "DEADLINE", id: "e", title: "受阻", dueAt: null, blocked: true, href: null, now },
  ]);
  assert.deepEqual(b.needsYou.map((i) => i.title), ["逾期", "受阻", "明天"]);
  assert.equal(b.handledQuietly, 1);
  assert.match(b.needsYou[0].why, /已逾期 2 天/);
});
