import assert from "node:assert/strict";
import test from "node:test";

import { envelopeFromMission, extractList, extractUnknowns } from "../src/modules/response-format/from-mission";
import { validate } from "../src/modules/response-format/validate";
import type { MissionReport } from "../src/modules/supervisor/report-format";

const OPTS = { model: "kern-demo（示例数据）", elapsedMs: 48210, quota: { used: 3, limit: 20 } };

const baseReport = (over: Partial<MissionReport> = {}): MissionReport => ({
  missionTaskId: "t1",
  title: "高蛋白零食",
  goal: "我想开发一个新产品：面向控糖白领的高蛋白零食\n已确认的约束：\n- 主要卖给谁：城市年轻白领\n- 预算：10 万以内",
  status: "SUCCEEDED",
  outcome: "COMPLETED",
  demo: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  constraints: [
    { question: "主要卖给谁", answer: "城市年轻白领" },
    { question: "预算", answer: "10 万以内" },
  ],
  conclusion: [
    "## 结论：推荐做「高蛋白海苔脆」",
    "",
    "**结论与建议**",
    "- 同价位蛋白含量领先约 40%",
    "- 合规路径清楚，无需新增资质",
    "",
    "**反对理由**",
    "- BOM 尚未询价，¥4.1 是假设值",
    "",
    "**主要风险**",
    "- 头部品牌 3 个月内跟进概率高",
    "- 原料季节波动 ±25%",
    "",
    "**需要你决定的事**：是否投入约 ¥58k 做为期 4 周的验证。",
  ].join("\n"),
  decision: null,
  recommendation: null,
  steps: [
    { key: "market", label: "市场与竞品研究", agent: "市场研究", status: "SUCCEEDED", output: "## 市场判断\n需求旺盛。\nUNKNOWN：线下便利店复购率（需要尼尔森二手零售数据）" },
    { key: "qa", label: "独立 QA 复核", agent: "QA", status: "SUCCEEDED", output: "PASS：证据边界清楚，可交付。" },
  ],
  meta: { tasksCreated: 9, maxTasks: 12, memoriesUsed: ["只做跨境电商"], successCriteria: [], humanGates: [] },
  ...over,
});

test("完整报告 → CONCLUSION 信封，且通过 harness", () => {
  const env = envelopeFromMission(baseReport(), OPTS);
  assert.equal(env.kind, "CONCLUSION");
  assert.equal(env.lede, "推荐做「高蛋白海苔脆」");
  const issues = validate(env);
  assert.deepEqual(issues, [], `不应有问题:\n${issues.map((i) => `${i.id} ${i.detail}`).join("\n")}`);
});

test("三段不全时降级为 ANSWER，绝不伪造决策卡", () => {
  const env = envelopeFromMission(
    baseReport({ conclusion: "## 结论\n看起来可行。\n\n**主要风险**\n- 有点风险" }),
    OPTS
  );
  assert.equal(env.kind, "ANSWER");
  assert.equal(env.blocks.some((b) => b.type === "decision"), false, "不应凭空造决策卡");
  assert.deepEqual(validate(env), []);
});

test("演示运行不携带额度（R8）", () => {
  const demo = envelopeFromMission(baseReport({ demo: true }), OPTS);
  assert.equal(demo.meta.quota, null);
  const real = envelopeFromMission(baseReport({ demo: false }), OPTS);
  assert.deepEqual(real.meta.quota, { used: 3, limit: 20 });
  assert.deepEqual(validate(real), []);
});

test("没有真实来源时挂诚实提示，且不产生 fact 要点", () => {
  const env = envelopeFromMission(baseReport(), { ...OPTS, sources: 0 });
  const callout = env.blocks.find((b) => b.type === "callout");
  assert.ok(callout && callout.type === "callout" && /没有联网研究/.test(callout.title));
  const kps = env.blocks.filter((b) => b.type === "keypoints");
  assert.equal(kps.length, 0, "无来源时不应输出 keypoints/fact，避免 R3 被绕过");
});

test("extractList 支持列表与行内两种写法", () => {
  assert.deepEqual(extractList("**主要风险**\n- a\n- b", /主要风险/), ["a", "b"]);
  assert.deepEqual(extractList("**主要风险**：a；b", /主要风险/), ["a", "b"]);
  assert.deepEqual(extractList("没有这一节", /主要风险/), []);
});

test("extractUnknowns 丢弃写不出 needs 的条目", () => {
  const ok = extractUnknowns([
    { key: "a", label: "", agent: "", status: "SUCCEEDED", output: "UNKNOWN：复购率（需要尼尔森数据）" },
    { key: "b", label: "", agent: "", status: "SUCCEEDED", output: "UNKNOWN：某个东西" },
  ]);
  assert.deepEqual(ok, [{ question: "复购率", needs: "尼尔森数据" }]);
});

test("QA 打回会被识别为 rej", () => {
  const env = envelopeFromMission(
    baseReport({
      steps: [{ key: "qa", label: "独立 QA 复核", agent: "QA", status: "SUCCEEDED", output: "REVISE：缺竞品对照" }],
    }),
    OPTS
  );
  const qa = env.blocks.find((b) => b.type === "qa");
  assert.ok(qa && qa.type === "qa" && qa.trail[0].verdict === "rej");
});

test("进度块反映每一步的真实状态", () => {
  const env = envelopeFromMission(
    baseReport({
      steps: [
        { key: "a", label: "A", agent: "x", status: "SUCCEEDED", output: "done" },
        { key: "b", label: "B", agent: "y", status: "BLOCKED", output: null },
      ],
    }),
    OPTS
  );
  const p = env.blocks.find((b) => b.type === "progress");
  assert.ok(p && p.type === "progress");
  assert.equal(p.done, 1);
  assert.equal(p.total, 2);
  assert.deepEqual(p.steps.map((s) => s.state), ["done", "blocked"]);
});
