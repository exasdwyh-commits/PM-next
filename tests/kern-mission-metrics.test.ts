/**
 * KX-73 结果指标 + 三次成功才自动化：纯函数单测。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewProductMissionPlan } from "@/modules/supervisor/plan";
import { buildTaskContract } from "@/modules/supervisor/contract";
import { aggregatePlaybookMetrics, automationEligibility, computeMissionMetrics } from "@/modules/supervisor/metrics";

const plan = buildNewProductMissionPlan("做一款智能宠物喂食器");
const u = "user-1";
const accepted = () => {
  const c = buildTaskContract({ plan });
  return { ...c, acceptance: c.acceptance.map((a) => ({ ...a, status: "PASS" as const })), reviews: [{ at: "2026-09-29T00:10:00Z", byUserId: u, rejected: [], round: 1 }] };
};

test("五个指标：完成、人工介入、返工、到结果耗时、单次成本", () => {
  const m = computeMissionMetrics({
    createdAt: "2026-09-29T00:00:00Z",
    outcome: { status: "COMPLETED", finishedAt: "2026-09-29T00:12:30Z" },
    state: { revisionRounds: 1, reruns: 1 },
    contract: accepted(),
    events: [
      { type: "mission.launched" },
      { type: "node.tool", payload: { tool: "model_call", ok: true, latencyMs: 1200 } },
      { type: "node.tool", payload: { tool: "model_call", ok: true, latencyMs: 800 } },
      { type: "node.tool", payload: { tool: "knowledge_search", ok: true, latencyMs: 50 } },
      { type: "mission.paused", actorUserId: u },
      { type: "user.input", actorUserId: u },
      { type: "node.rerun", actorUserId: u, payload: { reason: "USER" } },
      { type: "node.rerun", payload: { reason: "system" } },
      { type: "node.rerun", actorUserId: u, payload: { reason: "CONTRACT_REJECTED" } },
      { type: "node.rerun", actorUserId: u, payload: { reason: "USER_ANSWERED" } },
      { type: "contract.reviewed", actorUserId: u, payload: { accepted: false, rejected: [{ id: "human:1" }] } },
      { type: "contract.reviewed", actorUserId: u, payload: { accepted: true, rejected: [] } },
    ],
    tokens: 12345,
    now: new Date("2026-09-29T01:00:00Z"),
  });
  assert.equal(m.completed, true);
  assert.equal(m.accepted, true);
  assert.equal(m.humanInterventions, 4, "暂停 + 输入 + 手动重跑 + 打回；系统重跑与通过不算");
  assert.equal(m.reworkRounds, 3, "QA 1 + 重跑 1 + 打回 1");
  assert.equal(m.timeToResultMs, 12.5 * 60_000);
  assert.deepEqual(m.cost, { modelCalls: 2, modelLatencyMs: 2000, tokens: 12345, logicalCalls: 2, actualAttempts: null, successfulAttempts: null });
  assert.equal(m.computedAt, "2026-09-29T01:00:00.000Z");

  const running = computeMissionMetrics({ createdAt: "2026-09-29T00:00:00Z", outcome: null, state: { revisionRounds: 0 }, events: [] });
  assert.equal(running.completed, false);
  assert.equal(running.accepted, null, "没有契约 → null");
  assert.equal(running.timeToResultMs, null);
  const unreviewed = computeMissionMetrics({ createdAt: "2026-09-29T00:00:00Z", outcome: null, state: { revisionRounds: 0 }, contract: buildTaskContract({ plan }), events: [] });
  assert.equal(unreviewed.accepted, null, "有契约但没复核 → null");
});

test("做法汇总：完成 / 通过 / 平均值；未结束的任务不进平均", () => {
  const base = computeMissionMetrics({ createdAt: "2026-09-29T00:00:00Z", outcome: { status: "COMPLETED", finishedAt: "2026-09-29T00:10:00Z" }, state: { revisionRounds: 0 }, contract: accepted(), events: [{ type: "node.tool", payload: { tool: "model_call", latencyMs: 100 } }] });
  const slow = { ...base, humanInterventions: 2, reworkRounds: 1, timeToResultMs: 20 * 60_000, cost: { ...base.cost, modelCalls: 3 } };
  const failed = { ...base, completed: false, accepted: false };
  const running = { ...base, completed: false, accepted: null, timeToResultMs: null };
  const agg = aggregatePlaybookMetrics([base, slow, failed, running], 2);
  assert.equal(agg.runs, 4);
  assert.equal(agg.completed, 2);
  assert.equal(agg.accepted, 2);
  assert.equal(agg.acceptedStreak, 2);
  assert.equal(agg.avgHumanInterventions, 0.7, "(0+2+0)/3");
  assert.equal(agg.avgTimeToResultMs, Math.round(((10 + 20 + 10) * 60_000) / 3));
  assert.equal(agg.avgModelCalls, null, "legacy logical calls cannot become actual-attempt averages");
  assert.equal(aggregatePlaybookMetrics([{ ...base, cost: { ...base.cost, actualAttempts: 2 } }, { ...slow, cost: { ...slow.cost, actualAttempts: 4 } }], 2).avgModelCalls, 3);
  assert.equal(aggregatePlaybookMetrics([], 0).avgReworkRounds, null);
});

test("三次成功才自动化：演示 / 无做法 / 未复核 / 次数不够 都拒绝，给出人话原因", () => {
  const pb = { name: "竞品周报", acceptedStreak: 3 };
  assert.match(automationEligibility({ demo: true, playbook: pb, contract: accepted() }).reason ?? "", /演示/);
  assert.match(automationEligibility({ demo: false, playbook: null, contract: accepted() }).reason ?? "", /保存为做法/);
  assert.match(automationEligibility({ demo: false, playbook: pb, contract: buildTaskContract({ plan }) }).reason ?? "", /验收清单/);
  const two = automationEligibility({ demo: false, playbook: { ...pb, acceptedStreak: 2 }, contract: accepted() });
  assert.equal(two.allowed, false);
  assert.match(two.reason ?? "", /通过 2 次，还差 1 次/);
  assert.deepEqual(automationEligibility({ demo: false, playbook: pb, contract: accepted() }), { allowed: true, reason: null, streak: 3, required: 3 });
});
