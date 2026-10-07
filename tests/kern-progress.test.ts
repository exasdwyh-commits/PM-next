import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewProductMissionPlan, estimateMissionProgress, initialMissionState, type MissionState } from "../src/modules/supervisor/plan";
import { missionAttention } from "../src/modules/supervisor/service";
import { classifyAttention } from "../src/modules/supervisor/attention";
import { progressLabel, progressPct } from "../src/app/muse/mission-timeline";

const plan = buildNewProductMissionPlan("我想开发一个新产品");
const set = (s: MissionState, keys: string[], status: MissionState["nodes"][string]["status"]) => {
  for (const k of keys) s.nodes[k] = { ...s.nodes[k], status };
  return s;
};

test("PG1：初始 0%，全部结束 100%，未结束封顶 99", () => {
  const s0 = initialMissionState(plan);
  const p0 = estimateMissionProgress(plan, s0);
  assert.equal(p0.pct, 0);
  assert.equal(p0.remainingSteps, plan.nodes.length);
  assert.ok(p0.remainingDepth >= 3, "新产品计划至少三轮：专家 → QA → 综合");
  const all = set(initialMissionState(plan), plan.nodes.map((n) => n.key), "SUCCEEDED");
  assert.deepEqual(estimateMissionProgress(plan, all), { pct: 100, remainingSteps: 0, remainingDepth: 0 });
  const almost = set(initialMissionState(plan), plan.nodes.filter((n) => n.kind !== "SYNTHESIS").map((n) => n.key), "SUCCEEDED");
  const pa = estimateMissionProgress(plan, almost);
  assert.ok(pa.pct < 99 && pa.pct > 70, `综合节点权重更高：${pa.pct}`);
  assert.equal(pa.remainingDepth, 1);
});

test("PG2：进行中算一半、跳过算结束，进度单调", () => {
  const first = plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.key);
  const a = estimateMissionProgress(plan, set(initialMissionState(plan), first, "ACTIVE")).pct;
  const b = estimateMissionProgress(plan, set(initialMissionState(plan), first, "SUCCEEDED")).pct;
  const c = estimateMissionProgress(plan, set(initialMissionState(plan), first, "SKIPPED")).pct;
  assert.ok(a > 0 && a < b, `${a} < ${b}`);
  assert.equal(b, c);
});

test("PG3：界面用真实进度，老数据回退计数", () => {
  assert.equal(progressPct({ progress: { done: 1, total: 4 }, outcome: null }), 25);
  assert.equal(progressPct({ progress: { done: 1, total: 4, pct: 40 }, outcome: null }), 40);
  assert.equal(progressPct({ progress: { done: 3, total: 4, pct: 90 }, outcome: { status: "COMPLETED", reasons: [] } }), 100);
  assert.equal(progressLabel({ progress: { done: 1, total: 4, pct: 40, remainingDepth: 2 }, outcome: null }), "约 40% · 还剩 2 轮");
});

test("PG4：中断读模型只列需要人的事", () => {
  const ask = { askId: "a", nodeKey: "market", question: "只做线上？", defaultAssumption: "都做", askedAt: "", timeoutSec: null };
  assert.deepEqual(missionAttention({ outcome: null, paused: false, pendingAsks: [] }), []);
  assert.deepEqual(missionAttention({ outcome: null, paused: true, pendingAsks: [ask] }).map((x) => x.kind), ["ASK", "PAUSED"]);
  assert.deepEqual(missionAttention({ outcome: { status: "NEEDS_USER", reasons: [] }, paused: false, pendingAsks: [] }).map((x) => x.kind), ["NEEDS_USER"]);
  assert.deepEqual(missionAttention({ outcome: { status: "CANCELLED", reasons: [] }, paused: false, pendingAsks: [ask] }), []);
});

test("PG5：有未答提问的任务聚合成一条「需要你」", () => {
  const base = { kind: "MISSION" as const, id: "m", goal: "新产品", progress: { done: 1, total: 4 }, reasons: [], finishedAt: null, conversationId: null, seenByUser: true };
  const running = classifyAttention({ ...base, status: "RUNNING", openQuestions: 2 });
  assert.equal(running.level, "SURFACE");
  assert.match(running.why, /2 个问题/);
  assert.equal(classifyAttention({ ...base, status: "COMPLETED", openQuestions: 1 }).level, "SURFACE");
  assert.equal(classifyAttention({ ...base, status: "RUNNING", openQuestions: 0 }).level, "AUTO_HANDLE");
  assert.equal(classifyAttention({ ...base, status: "NEEDS_USER", openQuestions: 1 }).level, "INTERRUPT");
});
