/**
 * 有界编辑步骤回归（R1·report-quality/v1 · 编辑）。
 *
 * 锁住的是「自动修复必须有边界」：
 * - 阻断态不改写、可交付态不打扰；
 * - 超时、空响应、畸形短文本、主题漂移都原样放弃；
 * - 修完必须重新校验，问题没减少就不采用；
 * - 只调用模型一次。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { assessMissionReportQuality } from "../src/modules/supervisor/report-quality";
import { autoFixMissionReport, buildEditMessages, type ReportEditCall } from "../src/modules/supervisor/report-edit";
import { reportTitle, type MissionReport } from "../src/modules/supervisor/report-format";

const SHOT_GOAL =
  "好，其实我们想开发一款红参胶原蛋白肽女士奶粉，主打新疆三峰包奶源。目标人群35-55岁女性。预算大概10万以内。";

const baseMeta: MissionReport["meta"] = { tasksCreated: 6, maxTasks: 12, memoriesUsed: [], successCriteria: [], humanGates: [] };

/** 八节齐全、标注完整的合规正文：门禁判定为可交付。 */
const OK_CONCLUSION = [
  "## 结论摘要",
  "**结论与建议**：先做小批验证「红参胶原蛋白肽女士奶粉」（推断）。",
  "## 产品定位",
  "面向 35-55 岁女性，主打新疆奶源（推断）。",
  "## 成本与经济性",
  "单罐 BOM 尚未取到报价（UNKNOWN：代工报价（需要 3 家工厂询价））。",
  "## 销售机制与渠道",
  "小红书种草优先，抖音跟进（推断）。",
  "## 营销策略",
  "首批内容围绕女性日常营养（推断）。",
  "## 风险评估",
  "- 原料价格波动会影响毛利。",
  "## 合规边界",
  "功效宣称需按保健食品标准复核。",
  "## 验证计划与待决策",
  "**需要你决定**：是否在 10 万元以内启动首轮验证。",
].join("\n");

const SOURCES: MissionReport["researchSources"] = [
  { sourceId: "s1", eventId: "e1", title: "来源", url: "https://example.com/a", fetchedAt: "2026-10-14T01:00:00Z", sourceKind: "FETCHED_PAGE", contentHash: "h", snapshot: "body", truncated: false },
];

function mk(over: Partial<MissionReport> = {}): MissionReport {
  return {
    playbook: "NEW_PRODUCT",
    missionTaskId: "mission/edit",
    title: reportTitle(SHOT_GOAL),
    goal: SHOT_GOAL,
    status: "SUCCEEDED",
    outcome: "COMPLETED",
    demo: false,
    createdAt: "2026-10-14T00:00:00Z",
    constraints: [],
    conclusion: OK_CONCLUSION,
    decision: "是否在 10 万元以内启动首轮验证",
    recommendation: "红参胶原蛋白肽女士奶粉",
    steps: [],
    researchSources: SOURCES,
    meta: baseMeta,
    ...over,
  } as MissionReport;
}

/** 造一份「待补证草稿」：有一处无依据数字。 */
function draftReport(): { report: MissionReport; quality: ReturnType<typeof assessMissionReportQuality> } {
  const report = mk({ conclusion: `${OK_CONCLUSION}\n- 复购率约 22%，高于品类均值。` });
  const quality = assessMissionReportQuality(report);
  assert.equal(quality.status, "DRAFT_UNVERIFIED");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-NUMBER"));
  return { report, quality };
}

const echo: ReportEditCall = async () => ({ text: "unused" });

test("可交付态不触发编辑", async () => {
  const report = mk();
  const out = await autoFixMissionReport({ report, quality: assessMissionReportQuality(report), call: echo });
  assert.equal(out.attempted, false);
  assert.equal(out.applied, false);
});

test("阻断态不自动改写（主题错配必须重跑，不能改写包装）", async () => {
  const report = mk({
    demo: true,
    conclusion: "## 结论：推荐做「高蛋白海苔脆」（示例）\n同价位下蛋白含量领先约 40%。",
  });
  const quality = assessMissionReportQuality(report);
  assert.equal(quality.status, "BLOCKED");
  let called = 0;
  const out = await autoFixMissionReport({
    report,
    quality,
    call: async () => {
      called += 1;
      return { text: "改写后的内容" };
    },
  });
  assert.equal(called, 0, "阻断态不应调用模型");
  assert.equal(out.attempted, false);
  assert.match(out.note, /重跑/);
});

test("补齐有效：重校后问题减少即采用", async () => {
  const { report, quality } = draftReport();
  const fixed = `${OK_CONCLUSION}\n- 复购率约 22%（推断，来源：某平台 2026Q3 抽样 1200 份）。`;
  const out = await autoFixMissionReport({ report, quality, call: async () => ({ text: fixed }) });
  assert.equal(out.applied, true);
  assert.ok(out.quality.issues.length < quality.issues.length);
  assert.match(out.note, /已采用/);
});

test("超时：保留原稿与待补证状态，且取消信号贯通到底层调用", async () => {
  const { report, quality } = draftReport();
  let sawSignal = false;
  let signalAborted = false;
  const out = await autoFixMissionReport({
    report,
    quality,
    timeoutMs: 30,
    call: (_messages, opts) => {
      sawSignal = opts?.signal instanceof AbortSignal;
      opts?.signal?.addEventListener("abort", () => {
        signalAborted = true;
      });
      return new Promise(() => {});
    },
  });
  assert.equal(out.attempted, true);
  assert.equal(out.applied, false);
  assert.equal(out.conclusion, report.conclusion);
  assert.match(out.note, /超时/);
  assert.equal(sawSignal, true, "编辑超时必须把 AbortSignal 传给底层模型调用");
  // 超时触发 abort 后，底层调用应当能观察到取消。
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(signalAborted, true, "超时后底层调用的 signal 应当被 abort");
});

test("空响应：不采用", async () => {
  const { report, quality } = draftReport();
  const out = await autoFixMissionReport({ report, quality, call: async () => ({ text: "   " }) });
  assert.equal(out.applied, false);
  assert.match(out.note, /空内容/);
});

test("畸形短文本：不采用", async () => {
  const { report, quality } = draftReport();
  const out = await autoFixMissionReport({ report, quality, call: async () => ({ text: "就一句话。" }) });
  assert.equal(out.applied, false);
  assert.match(out.note, /畸形/);
});

test("主题漂移（改写后不谈奶粉）：不采用", async () => {
  const { report, quality } = draftReport();
  const out = await autoFixMissionReport({
    report,
    quality,
    call: async () => ({ text: `${OK_CONCLUSION.replace(/奶粉/g, "海苔脆")}\n- 复购率约 22%（推断）。` }),
  });
  assert.equal(out.applied, false);
  assert.match(out.note, /偏离研究对象/);
});

test("修完反而更差：不采用，保留原判定", async () => {
  const { report, quality } = draftReport();
  const out = await autoFixMissionReport({
    report,
    quality,
    call: async () => ({ text: `${OK_CONCLUSION}\n- 新增一个无依据数字 88%，再来一个 99%。` }),
  });
  assert.equal(out.applied, false);
  assert.equal(out.quality, quality);
  assert.match(out.note, /问题没有减少/);
});

test("只调用模型一次", async () => {
  const { report, quality } = draftReport();
  let calls = 0;
  await autoFixMissionReport({
    report,
    quality,
    call: async () => {
      calls += 1;
      return { text: `${OK_CONCLUSION}\n- 复购率约 22%（推断，来源：某平台 2026Q3 抽样 1200 份）。` };
    },
  });
  assert.equal(calls, 1);
});

test("编辑请求里带研究对象与问题清单，不给模型自由发挥空间", () => {
  const { report, quality } = draftReport();
  const messages = buildEditMessages(report, quality.issues);
  const joined = messages.map((m) => m.content).join("\n");
  assert.match(joined, /红参胶原蛋白肽女士奶粉/);
  assert.match(joined, /补齐方式/);
  assert.match(joined, /只输出修改后的完整报告正文/);
});

