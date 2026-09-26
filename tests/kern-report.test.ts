import assert from "node:assert/strict";
import test from "node:test";
import {
  conclusionLead,
  extractDecision,
  extractRecommendation,
  goalHeadline,
  markdownToHtml,
  missionReportMarkdown,
  parseConstraints,
  reportFileName,
  type MissionReport,
} from "../src/modules/supervisor/report-format";
import { parseProse } from "../src/app/muse/components/prose";

const GOAL = "我想开发一个新产品：便携咖啡机\n\n已确认的约束：\n- 主要卖给谁：城市年轻白领\n- 优先走什么渠道：线上电商 / 内容平台";

test("goal headline and constraints", () => {
  assert.equal(goalHeadline(GOAL), "我想开发一个新产品：便携咖啡机");
  assert.deepEqual(parseConstraints(GOAL), [
    { question: "主要卖给谁", answer: "城市年轻白领" },
    { question: "优先走什么渠道", answer: "线上电商 / 内容平台" },
  ]);
  assert.deepEqual(parseConstraints("没有约束"), []);
});

test("decision: inline, heading form, and 'nothing to decide'", () => {
  assert.equal(extractDecision("## 结论\n好\n\n**需要你决定的事**：是否投入 ¥58k 做 4 周验证。"), "是否投入 ¥58k 做 4 周验证。");
  const heading = "1. 结论与建议\n做 A\n5. 需要你决定的事\n- 是否签约代工厂\n- 定价 199 还是 249\n## 附录\n无关";
  assert.equal(extractDecision(heading), "- 是否签约代工厂\n- 定价 199 还是 249");
  assert.equal(extractDecision("5. 需要你决定的事：目前不需要你决定"), null);
  assert.equal(extractDecision("没有这一节"), null);
  assert.equal(extractDecision(null), null);
});

test("recommendation and lead", () => {
  assert.equal(extractRecommendation("## 结论：推荐做「高蛋白海苔脆」（示例）"), "高蛋白海苔脆");
  assert.equal(extractRecommendation("推荐方向：随行冷萃杯，理由…"), "随行冷萃杯");
  assert.equal(extractRecommendation("没有推荐"), null);
  assert.equal(conclusionLead("## 结论与建议\n\n**做 A**：窗口期短。"), "做 A：窗口期短。");
});

test("markdown → html is escaped and renders tables", () => {
  const html = markdownToHtml("# T <script>\n\n| 竞品 | 价格 |\n|---|---:|\n| X | ¥199 |\n| **Y** | ¥249 |\n\n- a\n- b");
  assert.ok(!html.includes("<script>"), "raw html escaped");
  assert.match(html, /<h1>T &lt;script&gt;<\/h1>/);
  assert.match(html, /<th>竞品<\/th><th>价格<\/th>/);
  assert.match(html, /<td><strong>Y<\/strong><\/td><td>¥249<\/td>/);
  assert.match(html, /<ul>\n<li>a<\/li>\n<li>b<\/li>\n<\/ul>/);
});

test("prose parses tables (and a lone pipe line stays text)", () => {
  const blocks = parseProse("对比：\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 |\n\n| 不是表");
  const t = blocks.find((b) => b.t === "table");
  assert.ok(t && t.t === "table");
  assert.deepEqual(t.head, ["A", "B"]);
  assert.deepEqual(t.rows, [["1", "2"], ["3"]]);
  assert.ok(blocks.some((b) => b.t === "p" && b.lines.includes("| 不是表")));
});

test("report markdown has decision, steps, meta, demo label", () => {
  const r: MissionReport = {
    missionTaskId: "m1", title: "便携咖啡机", goal: GOAL, status: "COMPLETED", outcome: "COMPLETED", demo: true,
    createdAt: "2026-09-26T08:00:00.000Z", constraints: parseConstraints(GOAL), conclusion: "推荐做「随行冷萃杯」",
    decision: "是否投入 ¥58k", recommendation: "随行冷萃杯",
    steps: [{ key: "market", label: "市场与竞品研究", agent: "市场研究", status: "SUCCEEDED", output: "需求 +38%" }, { key: "gtm", label: "上市", agent: "营销", status: "SKIPPED", output: null }],
    meta: { tasksCreated: 9, maxTasks: 16, memoriesUsed: ["预算 30 万"], successCriteria: ["有结论"], humanGates: [] },
  };
  const md = missionReportMarkdown(r);
  for (const s of ["# 便携咖啡机", "演示模式", "## 需要你决定", "是否投入 ¥58k", "### 市场与竞品研究（市场研究 · 完成）", "### 上市（营销 · 已跳过）", "（暂无产出）", "用到的记忆：预算 30 万", "演示运行不计额度", "**主要卖给谁**：城市年轻白领"]) {
    assert.ok(md.includes(s), `missing ${s}`);
  }
  assert.equal(reportFileName(r, "md"), "便携咖啡机-2026-09-26.md");
});

test("goal audience + heading demotion", async () => {
  const { goalAudience, demoteHeadings } = await import("../src/modules/supervisor/report-format");
  assert.equal(goalAudience("我想开发一个新产品：面向白领的健康零食"), "白领");
  assert.equal(goalAudience("我想开发一个新产品：便携咖啡机"), null);
  assert.equal(demoteHeadings("## 市场判断\n# 顶\n###### 深", 4), "##### 市场判断\n#### 顶\n###### 深");
});
