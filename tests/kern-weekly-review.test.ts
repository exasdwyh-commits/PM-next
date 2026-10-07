import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyReview, reviewSummaryLine } from "../src/modules/supervisor/weekly-review";
import type { MissionMetrics } from "../src/modules/kern-contracts";

const until = new Date("2026-09-29T00:00:00Z");
const since = new Date(until.getTime() - 7 * 86_400_000);
const metrics = (p: Partial<MissionMetrics>): MissionMetrics => ({
  version: "kern-mission-metrics/v1",
  completed: true,
  accepted: true,
  humanInterventions: 1,
  reworkRounds: 0,
  timeToResultMs: 60_000,
  cost: { modelCalls: 9, modelLatencyMs: 0, tokens: null },
  computedAt: until.toISOString(),
  ...p,
});
const daysAgo = (n: number) => new Date(until.getTime() - n * 86_400_000);

test("KX-74 weekly review: summary aggregates metrics, empty week says so", () => {
  const r = buildWeeklyReview({
    since,
    until,
    missions: [
      { id: "m1", goal: "a", createdAt: daysAgo(1), metrics: metrics({}), playbookRef: null },
      { id: "m2", goal: "b", createdAt: daysAgo(2), metrics: metrics({ completed: false, accepted: null, humanInterventions: 3, reworkRounds: 2, timeToResultMs: null }), playbookRef: null },
      { id: "m3", goal: "c", createdAt: daysAgo(3), metrics: null, playbookRef: null },
    ],
    memories: [],
    playbooks: [],
  });
  assert.deepEqual(r.summary, { runs: 3, completed: 1, accepted: 1, avgHumanInterventions: 2, avgReworkRounds: 1, avgTimeToResultMs: 60000, modelCalls: 18 });
  assert.match(reviewSummaryLine(r), /跑了 3 项，完成 1 项，验收通过 1 项/);
  assert.match(reviewSummaryLine(buildWeeklyReview({ since, until, missions: [], memories: [], playbooks: [] })), /没有跑过任务/);
});

test("KX-74 weekly review: repeated corrections → charter proposal; stale outcomes → forget; used corrections → pin", () => {
  const r = buildWeeklyReview({
    since,
    until,
    missions: [],
    memories: [
      { id: "c1", kind: "CORRECTION", content: "做「宠物饮水机」这类工作时：要给价格区间（针对「有结论」）", pinned: false, topics: ["宠物", "饮水", "水机"], useCount: 0, createdAt: daysAgo(3) },
      { id: "c2", kind: "CORRECTION", content: "做「宠物饮水机选型」这类工作时：列出竞品", pinned: false, topics: ["宠物", "饮水", "选型"], useCount: 0, createdAt: daysAgo(2) },
      { id: "c3", kind: "CORRECTION", content: "做「周报」这类工作时：先写结论", pinned: false, topics: ["周报"], useCount: 4, createdAt: daysAgo(10) },
      { id: "o1", kind: "OUTCOME", content: "旧结论", pinned: false, topics: [], useCount: 0, createdAt: daysAgo(40) },
      { id: "o2", kind: "OUTCOME", content: "新结论", pinned: false, topics: [], useCount: 0, createdAt: daysAgo(2) },
      { id: "o3", kind: "OUTCOME", content: "旧但常用", pinned: false, topics: [], useCount: 2, createdAt: daysAgo(40) },
      { id: "p1", kind: "PREFERENCE", content: "旧偏好", pinned: false, topics: [], useCount: 0, createdAt: daysAgo(90) },
    ],
    playbooks: [
      { id: "pb1", name: "竞品周报", metrics: { runs: 4, completed: 4, accepted: 3, acceptedStreak: 3, avgHumanInterventions: 0, avgReworkRounds: 0, avgTimeToResultMs: 1, avgModelCalls: 1 } },
      { id: "pb2", name: "烂做法", metrics: { runs: 4, completed: 1, accepted: 0, acceptedStreak: 0, avgHumanInterventions: 3, avgReworkRounds: 2, avgTimeToResultMs: 1, avgModelCalls: 1 } },
      { id: "pb3", name: "新做法", metrics: { runs: 1, completed: 0, accepted: 0, acceptedStreak: 0, avgHumanInterventions: null, avgReworkRounds: null, avgTimeToResultMs: null, avgModelCalls: null } },
    ],
  });
  const byId = Object.fromEntries(r.proposals.map((p) => [p.id, p]));
  assert.ok(byId["charter:c1"], JSON.stringify(r.proposals.map((p) => p.id)));
  assert.equal(byId["charter:c1"].apply.op, "memory.remember");
  assert.match((byId["charter:c1"].apply as { content: string }).content, /^做「宠物饮水机」这类工作时：要给价格区间；列出竞品$/);
  assert.ok(byId["pin:c3"] && byId["pin:c3"].apply.op === "memory.pin");
  assert.ok(byId["forget:o1"], "stale unused outcome");
  assert.ok(!byId["forget:o2"] && !byId["forget:o3"] && !byId["forget:p1"], "recent / used / preference are kept");
  assert.equal(byId["automate:pb1"]?.apply.op, "note");
  assert.equal(byId["retire:pb2"]?.apply.op, "playbook.delete");
  assert.ok(!byId["retire:pb3"], "too few runs to judge");
  assert.ok(r.proposals.every((p) => ["charter", "memory", "playbook"].includes(p.kind)));
});
