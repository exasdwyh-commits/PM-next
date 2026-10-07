/**
 * 诚实事件（node.hypothesis / node.refuted / node.retracted）
 * =========================================================
 *
 * 产品命题：Agent 的可信度不来自「从不出错」，而来自**猜测标成猜测、错了当场收回**。
 * 这三类事件把原本只存在于正文和内部状态里的三件事摆到时间线上：
 *   1. 这一步里哪些是推断、哪些还不知道；
 *   2. 哪一步的结论被复核推翻了；
 *   3. 哪些下游结论因此作废 —— 以前它们只是被悄悄重算，用户永远不知道
 *      「刚才给你的那个结论，现在不作数了」。
 *
 * 全部为纯函数，不连库、不连模型。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { extractMarkedClaims } from "../src/modules/supervisor/claims";
import {
  applyRevision,
  buildNewProductMissionPlan,
  initialMissionState,
  revisionImpact,
} from "../src/modules/supervisor/plan";
import { MISSION_EVENT_TYPES } from "../src/modules/supervisor/events";
import { demoOutput } from "../src/modules/supervisor/demo";
import { describeEvent, type MissionEvent } from "../src/app/muse/mission-timeline";

const ev = (type: string, nodeKey: string | null, payload: Record<string, unknown>): MissionEvent => ({
  id: "1", seq: 1, type, nodeKey, actorUserId: null, payload, demo: false,
  createdAt: new Date(1_700_000_000_000).toISOString(),
});

test("claims: 抓到被标注的推断与 UNKNOWN，且不把标题/表头当成主张", () => {
  const market = extractMarkedClaims(demoOutput("market", "SPECIALIST", 1));
  assert.equal(market.hypotheses.length, 1);
  assert.match(market.hypotheses[0], /搜索量同比/);
  assert.deepEqual(market.unknowns, ["UNKNOWN：线下便利店复购率。"]);

  // 「| 项目 | 假设 |」是表头，不是一条假设；「（假设，需 3 家代工询价）」才是。
  const econ = extractMarkedClaims(demoOutput("economics", "SPECIALIST", 1));
  assert.equal(econ.hypotheses.length, 1);
  assert.match(econ.hypotheses[0], /BOM/);

  // 「| 假设 | 方法 | 通过线 |」同理：整张验证计划表不含任何未标注主张。
  assert.deepEqual(extractMarkedClaims(demoOutput("validation", "SPECIALIST", 1)), { hypotheses: [], unknowns: [] });
});

test("claims: 忽略输出契约自带的指令行，避免把提示词回声当成推断", () => {
  const text = [
    "## 2. 关键依据（标注 事实/推断）",
    "区分事实与推断；没有来源的数字必须标注“推断”或“UNKNOWN”。",
    "- 客单价 ¥120（推断，未取样）",
  ].join("\n");
  assert.deepEqual(extractMarkedClaims(text).hypotheses, ["客单价 ¥120（推断，未取样）"]);
});

test("claims: 去重、限条数、限长度；一行兼具两种标记时按 UNKNOWN 记", () => {
  const dup = ["- A（推断）", "- A（推断）", "- B（推断）"].join("\n");
  assert.deepEqual(extractMarkedClaims(dup).hypotheses, ["A（推断）", "B（推断）"]);

  const many = Array.from({ length: 12 }, (_, i) => `- 第 ${i} 条（推断）`).join("\n");
  assert.equal(extractMarkedClaims(many, 3).hypotheses.length, 3);

  const long = "- " + "长".repeat(400) + "（推断）";
  const item = extractMarkedClaims(long).hypotheses[0];
  assert.equal(item.length, 201);
  assert.ok(item.endsWith("…"));

  const both = extractMarkedClaims("- 转化率（推断）：UNKNOWN，缺埋点");
  assert.deepEqual(both.hypotheses, []);
  assert.equal(both.unknowns.length, 1);
});

test("revisionImpact: 点名的叫推翻，连带的叫作废，QA 自己不算作废", () => {
  const plan = buildNewProductMissionPlan("我想开发一个新的产品");
  const qaKey = plan.nodes.find((n) => n.kind === "QA")!.key;
  const impact = revisionImpact(plan, { type: "REVISE", nodeKeys: ["market"], feedback: { market: "缺竞品对照" } });

  assert.deepEqual(impact.refuted, ["market"]);
  assert.ok(impact.retracted.includes("opportunity"), "下游机会判断应被连带作废");
  assert.ok(!impact.retracted.includes("market"), "被点名的不算连带作废");
  assert.ok(!impact.retracted.includes(qaKey), "QA 是发起方，不是被作废方");
  assert.ok(!impact.retracted.some((k) => plan.nodes.find((n) => n.key === k)?.kind === "SYNTHESIS"));
  assert.deepEqual([...impact.reset].sort(), [...new Set([...impact.refuted, ...impact.retracted, qaKey])].sort());
});

test("revisionImpact 与 applyRevision 同源：事件说作废的，正是状态机重置的", () => {
  const plan = buildNewProductMissionPlan("我想开发一个新的产品");
  const before = initialMissionState(plan);
  for (const key of Object.keys(before.nodes)) before.nodes[key].status = "SUCCEEDED";
  const action = { type: "REVISE" as const, nodeKeys: ["market", "market", "不存在的节点"], feedback: { market: "缺竞品对照" } };

  const after = applyRevision(plan, before, action);
  const impact = revisionImpact(plan, action);
  const pending = Object.keys(after.nodes).filter((k) => after.nodes[k].status === "PENDING");

  assert.deepEqual(pending.sort(), [...impact.reset].sort());
  assert.deepEqual(impact.refuted, ["market"], "不存在的节点与重复项不应出现在事件里");
  assert.equal(after.nodes.market.revisionFeedback, "缺竞品对照");
  assert.equal(after.revisionRounds, before.revisionRounds + 1);
});

test("三类事件已登记，且在时间线上是人话", () => {
  for (const t of ["node.hypothesis", "node.refuted", "node.retracted"]) {
    assert.ok((MISSION_EVENT_TYPES as readonly string[]).includes(t), `${t} 未登记`);
  }

  const h = describeEvent(ev("node.hypothesis", "market", { hypotheses: ["a", "b"], unknowns: ["c"] }))!;
  assert.match(h.text, /2 处推断/);
  assert.match(h.text, /1 项还不知道/);
  assert.match(h.text, /别当结论用/);
  assert.equal(describeEvent(ev("node.hypothesis", "market", { hypotheses: [], unknowns: [] })), null);

  const r = describeEvent(ev("node.refuted", "market", { round: 1, feedback: "缺竞品对照" }))!;
  assert.equal(r.kind, "qa");
  assert.match(r.text, /被复核推翻：缺竞品对照/);
  assert.match(describeEvent(ev("node.refuted", "market", { round: 1, feedback: null }))!.text, /被复核推翻$/);

  const rt = describeEvent(ev("node.retracted", "opportunity", { round: 1, cause: "UPSTREAM_REFUTED", upstream: ["market"] }))!;
  assert.match(rt.text, /作废/);
});
