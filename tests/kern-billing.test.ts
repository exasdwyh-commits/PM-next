import assert from "node:assert/strict";
import test from "node:test";
import { currentPeriod, limitsFor } from "../src/modules/billing";

test("billing period anchors on subscription day and rolls monthly", () => {
  const p = currentPeriod(new Date("2026-01-15T00:00:00Z"), new Date("2026-09-26T08:00:00Z"));
  assert.equal(p.start.toISOString().slice(0, 10), "2026-09-15");
  assert.equal(p.end.toISOString().slice(0, 10), "2026-10-15");
  const q = currentPeriod(new Date("2026-01-30T00:00:00Z"), new Date("2026-09-10T00:00:00Z"));
  assert.equal(q.start.toISOString().slice(0, 10), "2026-08-28");
});

test("plan limits with env override", () => {
  assert.equal(limitsFor("FREE").missionsPerMonth, 5);
  process.env.KERN_PLAN_FREE_MISSIONS = "9";
  assert.equal(limitsFor("FREE").missionsPerMonth, 9);
  delete process.env.KERN_PLAN_FREE_MISSIONS;
  assert.equal(limitsFor("TEAM").missionsPerMonth, null);
});
