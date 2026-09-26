import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChallenges,
  buildLanes,
  buildTimeline,
  currentActivity,
  mergeEvents,
  reasonLabel,
  totalModelCalls,
  type MissionEvent,
  type MissionStatusView,
} from "../src/app/muse/mission-timeline";

let seq = 0;
const ev = (type: string, nodeKey: string | null, payload: Record<string, unknown> = {}): MissionEvent => ({
  id: String(++seq), seq, type, nodeKey, actorUserId: null, payload, demo: false, createdAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
});

const status = (over: Partial<MissionStatusView> = {}): MissionStatusView => ({
  missionTaskId: "m", status: "RUNNING", goal: "g", playbook: "NEW_PRODUCT", progress: { done: 1, total: 3 },
  revisionRounds: 0, tasksCreated: 2, outcome: null, paused: null, userInputs: [],
  nodes: [
    { key: "market", kind: "SPECIALIST", agentCode: "research_agent", status: "SUCCEEDED", attempts: 2, taskId: "t1", critical: true },
    { key: "qa", kind: "QA", agentCode: "qa_verifier", status: "SUCCEEDED", attempts: 1, taskId: "t2" },
    { key: "synthesis", kind: "SYNTHESIS", agentCode: "hermes_pm", status: "ACTIVE", attempts: 1, taskId: "t3" },
  ],
  ...over,
});

const events = [
  ev("mission.launched", null, { nodes: [1, 2, 3] }),
  ev("node.dispatched", "market", { agentCode: "research_agent", attempt: 1 }),
  ev("node.started", "market", { method: ["竞品矩阵"], userInputIds: [] }),
  ev("node.tool", "market", { tool: "model_call", ok: true, latencyMs: 1200, model: "m1", provider: "p" }),
  ev("node.delta", "market", { text: "# 市场\n需求强劲", complete: true }),
  ev("node.finished", "market", { status: "SUCCEEDED", durationMs: 1500 }),
  ev("node.finished", "qa", { status: "SUCCEEDED", qa: { verdict: "REVISE", issues: [{ target: "market", problem: "缺竞品" }] } }),
  ev("qa.revise", null, { nodeKeys: ["market"], round: 1 }),
  ev("user.input", null, { text: "预算 50 万", inputId: "u1" }),
  ev("node.dispatched", "market", { agentCode: "research_agent", attempt: 2, revision: true }),
  ev("user.input.applied", "market", { inputId: "u1" }),
  ev("node.started", "market", { method: [], userInputIds: ["u1"] }),
  ev("node.tool", "market", { tool: "model_call", ok: true, latencyMs: 800, model: "m1" }),
  ev("node.delta", "market", { text: "修订版", complete: true }),
  ev("node.finished", "market", { status: "SUCCEEDED" }),
];

test("lanes: plan order, attempts, model calls, output per attempt", () => {
  const lanes = buildLanes(status(), events);
  assert.deepEqual(lanes.map((l) => l.key), ["market", "qa", "synthesis"]);
  const m = lanes[0];
  assert.equal(m.label, "市场与竞品研究");
  assert.equal(m.attempts.length, 2);
  assert.equal(m.attempts[0].output, "# 市场\n需求强劲");
  assert.equal(m.attempts[0].durationMs, 1500);
  assert.deepEqual(m.attempts[0].method, ["竞品矩阵"]);
  assert.equal(m.attempts[1].revision, true);
  assert.deepEqual(m.attempts[1].userInputIds, ["u1"]);
  assert.equal(m.attempts[1].output, "修订版");
  assert.deepEqual(totalModelCalls(lanes), { calls: 2, latencyMs: 2000 });
});

test("timeline sentences hide deltas and label user actions", () => {
  const t = buildTimeline(events);
  assert.ok(!t.some((x) => /需求强劲/.test(x.text)), "deltas stay in the lane");
  assert.ok(t.some((x) => x.kind === "user" && /将带入后续步骤/.test(x.text)));
  assert.ok(t.some((x) => x.kind === "user" && /已带入「市场与竞品研究」/.test(x.text)));
  assert.ok(t.some((x) => x.kind === "qa" && /QA 要求返工：市场与竞品研究/.test(x.text)));
  assert.ok(t.some((x) => /研究返工「市场与竞品研究」/.test(x.text)));
});

test("challenges link QA verdict to what was revised", () => {
  const c = buildChallenges(events);
  assert.equal(c.length, 1);
  assert.equal(c[0].verdict, "REVISE");
  assert.deepEqual(c[0].revised, ["market"]);
});

test("current activity: active, paused, finished, cancelled", () => {
  assert.match(currentActivity(status(), events), /正在：Kern「Kern 综合结论」/);
  assert.match(currentActivity(status({ paused: { at: "x", byUserId: "u" } }), events), /已暂停/);
  assert.match(currentActivity(status({ outcome: { status: "COMPLETED", reasons: [] } }), events), /全部完成/);
  assert.match(currentActivity(status({ outcome: { status: "NEEDS_USER", reasons: ["CRITICAL_market_SKIPPED"] } }), events), /关键步骤「市场与竞品研究」被跳过/);
  assert.equal(currentActivity(status({ outcome: { status: "CANCELLED", reasons: [] } }), events), "你取消了任务");
});

test("reason labels and event merge are stable", () => {
  assert.equal(reasonLabel("MODEL_UNAVAILABLE: no policy"), "当前没有可用的模型");
  assert.equal(reasonLabel("USER_SKIPPED"), "你跳过了这一步");
  const merged = mergeEvents(events.slice(0, 5), [...events.slice(3, 8)].reverse());
  assert.deepEqual(merged.map((e) => e.seq), events.slice(0, 8).map((e) => e.seq));
});
