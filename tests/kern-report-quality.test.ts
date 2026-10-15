/**
 * 研究报告质量门禁回归（R1·report-quality/v1）。
 *
 * 这份测试锁住的是「用户看到的那份报告」的实际症状，不是内部实现：
 * - 标题不能是整句提问；
 * - 需求说奶粉、结论讲海苔时必须被拦住；
 * - 结构、约束、缺口不合格时降级为待补证草稿；
 * - 卡片 / 报告页 / 下载三处读到同一个状态；
 * - 界面不再裸露英文 UNKNOWN，也不再宣称结论「已核实」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";

import {
  assessMissionReportQuality,
  reportContentVersion,
  REPORT_QUALITY_LABEL,
} from "../src/modules/supervisor/report-quality";
import { goalConstraintPhrases, reportSubject, reportTitle, type MissionReport } from "../src/modules/supervisor/report-format";
import { buildMissionPoster, missionPosterCitation } from "../src/modules/supervisor/report-poster";
import { collectMissionSources, uniqueMissionSources } from "../src/modules/supervisor/research-sources";
import type { MissionEventRecord } from "../src/modules/supervisor/events";

/** 截图里的原始需求：整句提问 + 人群 + 预算 + 主推要素。 */
const SHOT_GOAL =
  "好，其实我们想开发一款红参胶原蛋白肽女士奶粉，主打新疆三峰包奶源。目标人群35-55岁女性。预算大概10万以内。";

const baseMeta: MissionReport["meta"] = { tasksCreated: 6, maxTasks: 12, memoriesUsed: [], successCriteria: [], humanGates: [] };

/** 截图里那份报告：需求是奶粉，演示脚本给的是海苔。 */
function haitaiDemoReport(): MissionReport {
  return {
    playbook: "NEW_PRODUCT",
    missionTaskId: "mission/haitai",
    title: reportTitle(SHOT_GOAL),
    goal: SHOT_GOAL,
    status: "SUCCEEDED",
    outcome: "COMPLETED",
    demo: true,
    createdAt: "2026-10-14T00:00:00Z",
    constraints: [],
    conclusion:
      "## 结论：推荐做「高蛋白海苔脆」（示例）\n同价位下蛋白含量领先约 40%，合规路径清楚，窗口期 6–9 个月。\n\n**主要风险**：头部跟进、原料价格波动、口感。\n\n**需要你决定的事**：是否投入约 ¥58k 做为期 4 周的验证。",
    decision: "是否投入约 ¥58k 做为期 4 周的验证",
    recommendation: "高蛋白海苔脆",
    steps: [
      {
        key: "market",
        label: "市场",
        agent: "研究员",
        status: "SUCCEEDED",
        output: "## 市场判断（示例）\n- 需求：25–35 岁城市白领对低糖高蛋白零食搜索量同比 +38%\n- **UNKNOWN**：线下便利店复购率。",
      },
    ],
    researchSources: [],
    meta: baseMeta,
  };
}

/** 一份满足主题、契约、约束、缺口要求的报告。 */
function compliantReport(): MissionReport {
  return {
    playbook: "NEW_PRODUCT",
    missionTaskId: "mission/ok",
    title: reportTitle(SHOT_GOAL),
    goal: SHOT_GOAL,
    status: "SUCCEEDED",
    outcome: "COMPLETED",
    demo: false,
    createdAt: "2026-10-14T00:00:00Z",
    constraints: [],
    conclusion: [
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
    ].join("\n"),
    decision: "是否在 10 万元以内启动首轮验证",
    recommendation: "红参胶原蛋白肽女士奶粉",
    steps: [
      { key: "market", label: "市场", agent: "研究员", status: "SUCCEEDED", output: "## 市场判断\n- 需求稳定（事实）[source:s1]" },
    ],
    researchSources: [
      { sourceId: "s1", eventId: "e1", title: "来源", url: "https://example.com/a", fetchedAt: "2026-10-14T01:00:00Z", sourceKind: "FETCHED_PAGE", contentHash: "h", snapshot: "body", truncated: false },
    ],
    meta: baseMeta,
  };
}

test("截图里的整句提问被抽成研究主题，而不是直接当标题", () => {
  assert.equal(reportSubject(SHOT_GOAL), "红参胶原蛋白肽女士奶粉");
  assert.equal(reportTitle(SHOT_GOAL), "红参胶原蛋白肽女士奶粉");
  assert.doesNotMatch(reportTitle(SHOT_GOAL), /其实|我们想|预算|大概/);
});

test("需求里的约束被读出来：人群、预算、主推要素都不丢", () => {
  const constraints = goalConstraintPhrases(SHOT_GOAL);
  const byKind = (kind: string) => constraints.find((item) => item.kind === kind)?.text ?? "";
  assert.match(byKind("人群"), /35/);
  assert.match(byKind("预算"), /10/);
  assert.match(byKind("主推要素"), /新疆/);
});

test("需求是奶粉、结论讲海苔：报告被质量门禁阻断", () => {
  const quality = assessMissionReportQuality(haitaiDemoReport());
  assert.equal(quality.status, "BLOCKED");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-TOPIC"), "应报主题不一致");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-DEMO"), "应标记演示内容不适配");
});

test("共享修饰词（都含「蛋白」）不算主题一致", () => {
  const quality = assessMissionReportQuality(haitaiDemoReport());
  assert.ok(quality.issues.some((issue) => issue.rule === "R-TOPIC"));
});

test("主题与契约都满足时，报告可交付", () => {
  const quality = assessMissionReportQuality(compliantReport());
  assert.deepEqual(quality.issues, []);
  assert.equal(quality.status, "DELIVERABLE");
});

test("八节契约不完整时降级为待补证草稿，而不是直接放行", () => {
  const report = compliantReport();
  const quality = assessMissionReportQuality({ ...report, conclusion: "## 结论摘要\n**结论与建议**：做奶粉（推断）" });
  assert.equal(quality.status, "DRAFT_UNVERIFIED");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-CONTRACT"));
});

test("需求写明的人群与预算没进报告时，提示补齐而不是悄悄忽略", () => {
  const report = compliantReport();
  const stripped = report.conclusion!.replace(/35-55 岁女性/g, "目标用户").replace(/10 万元/g, "预算内");
  const quality = assessMissionReportQuality({ ...report, conclusion: stripped });
  assert.ok(quality.issues.some((issue) => issue.rule === "R-CONSTRAINT"), "应提示约束未覆盖");
});

test("缺口没写补齐方式时仍保留，并提示补上怎么补", () => {
  const report = compliantReport();
  const quality = assessMissionReportQuality({
    ...report,
    conclusion: report.conclusion!.replace("（需要 3 家工厂询价）", ""),
  });
  assert.ok(quality.issues.some((issue) => issue.rule === "R-UNKNOWN"));
});

test("没有形成结论时不能作为正式报告交付", () => {
  const quality = assessMissionReportQuality({ ...compliantReport(), conclusion: null });
  assert.equal(quality.status, "BLOCKED");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-CONTENT"));
});

test("内容变了，质量判定的版本也随之变化", () => {
  const report = compliantReport();
  assert.notEqual(reportContentVersion(report), reportContentVersion({ ...report, conclusion: `${report.conclusion}\n补充一行` }));
});

test("海报与卡片引用绑定同一个质量状态", () => {
  const report = haitaiDemoReport();
  const quality = assessMissionReportQuality(report);
  const poster = buildMissionPoster(report, quality);
  assert.equal(poster.quality?.status, "BLOCKED");
  assert.equal(poster.verificationStatus, "BLOCKED_BY_QUALITY");
  assert.equal(poster.title, `${report.title}（演示） · 新产品研究报告`);
  assert.equal(missionPosterCitation(poster, report.missionTaskId).qualityStatus, "BLOCKED");
});

test("状态文案表覆盖三种状态，界面不再自己拼词", () => {
  assert.equal(REPORT_QUALITY_LABEL.BLOCKED, "未通过质量检查");
  assert.equal(REPORT_QUALITY_LABEL.DRAFT_UNVERIFIED, "待补证草稿");
  assert.equal(REPORT_QUALITY_LABEL.DELIVERABLE, "可交付");
});

test("交付入口都经过质量门禁（预览、报告页、下载）", () => {
  const response = fs.readFileSync("src/modules/supervisor/response.ts", "utf8");
  assert.match(response, /assessMissionReportQuality/);
  const page = fs.readFileSync("src/app/reports/missions/[id]/page.tsx", "utf8");
  assert.match(page, /assessMissionReportQuality/);
  const exp = fs.readFileSync("src/app/api/missions/[id]/export/route.ts", "utf8");
  // 门禁改由交付计划统一提供（Markdown / PDF / Office 共用），守卫随之收紧：
  // 门禁必须在 Office 分支之前，且阻断时终止交付。
  assert.match(exp, /planMissionDelivery/);
  assert.ok(
    exp.indexOf("planMissionDelivery(report)") < exp.indexOf("OFFICE.has(format)"),
    "门禁必须排在 Office 分支之前，否则正式导出件会绕过检查",
  );
  assert.match(exp, /if \(plan\.blocked\)/);
});

test("界面不再裸露英文 UNKNOWN，也不再宣称结论已核实", () => {
  const card = fs.readFileSync("src/app/muse/rich/report-card.tsx", "utf8");
  assert.doesNotMatch(card, /项 UNKNOWN/);
  assert.match(card, /项待验证/);
  const rich = fs.readFileSync("src/app/muse/components/mission-conclusion-rich.tsx", "utf8");
  assert.doesNotMatch(rich, /任务结论已核实/);
  assert.doesNotMatch(rich, /可直接用于客户沟通/);
  // 报告页（v3 海报）：缺口卡与假设卡的角标也必须是中文，不能只有结论卡被换过。
  const v3 = fs.readFileSync("src/components/report-v3.tsx", "utf8");
  assert.doesNotMatch(v3, />\s*UNKNOWN\s*</);
  assert.match(v3, /badge unknown">待验证</);
});
/* ---------- 需求 §5：多来源重复 / 矛盾 / 不相关材料 ---------- */

/** 造一条来源引用事件；contentHash 必须与快照自洽，否则按来路不明丢弃。 */
function cite(over: { id: string; seq: number; nodeKey: string; sourceId: string; url: string; taskId?: string }): MissionEventRecord {
  const snapshot = `snapshot-${over.sourceId}`;
  return {
    id: over.id,
    seq: over.seq,
    type: "node.cite",
    nodeKey: over.nodeKey,
    actorUserId: null,
    demo: false,
    createdAt: "2026-10-14T01:00:00Z",
    payload: {
      taskId: over.taskId ?? "task-1",
      sourceId: over.sourceId,
      url: over.url,
      title: over.url,
      snapshot,
      contentHash: createHash("sha256").update(snapshot).digest("hex"),
      fetchedAt: "2026-10-14T01:00:00Z",
      sourceKind: "FETCHED_PAGE",
    },
  };
}

function missionEvent(type: MissionEventRecord["type"], nodeKey: string, payload: Record<string, unknown> = {}): MissionEventRecord {
  return { id: `${type}-${nodeKey}`, seq: 99, type, nodeKey, actorUserId: null, demo: false, createdAt: "2026-10-14T01:00:00Z", payload };
}

const CONFLICT_SOURCES: MissionReport["researchSources"] = [
  { sourceId: "s1", eventId: "e1", title: "平台 A 抽样", url: "https://example.com/a", fetchedAt: "2026-10-14T01:00:00Z", sourceKind: "FETCHED_PAGE", contentHash: "h1", snapshot: "body", truncated: false },
  { sourceId: "s2", eventId: "e2", title: "平台 B 抽样", url: "https://example.com/b", fetchedAt: "2026-10-14T01:00:00Z", sourceKind: "FETCHED_PAGE", contentHash: "h2", snapshot: "body", truncated: false },
];

/** 两份材料给出互相打架的数字（22% 与 9%），其余八节齐全；extra 用来挂缺口行。 */
function conflictConclusion(extra = ""): string {
  const lines = [
    "## 结论摘要",
    "**结论与建议**：先做小批验证「红参胶原蛋白肽女士奶粉」（事实）。",
    "## 产品定位",
    "面向 35-55 岁女性，主打新疆奶源（事实）。",
    "## 成本与经济性",
    "单罐成本按 10 万元以内的预算控制（事实）。",
    "## 销售机制与渠道",
    "小红书种草优先（事实）。",
    "## 营销策略",
    "首批内容围绕女性日常营养（事实）。",
    "## 风险评估",
    "- 线上复购率约 22%（事实）[source:s1]；另一份材料给出复购率约 9%（事实）[source:s2]。",
    "## 合规边界",
    "功效宣称需按保健食品标准复核。",
    "## 验证计划与待决策",
    "**需要你决定**：是否在 10 万元以内启动首轮验证。",
  ];
  if (extra) lines.push(extra);
  return lines.join(String.fromCharCode(10));
}

test("同一份材料被多个节点重复引用：对外只算一条来源", () => {
  const raw = collectMissionSources([
    cite({ id: "e1", seq: 1, nodeKey: "market", sourceId: "dup", url: "https://example.com/dup" }),
    cite({ id: "e2", seq: 2, nodeKey: "competitor", sourceId: "dup", url: "https://example.com/dup" }),
  ]);
  assert.equal(raw.length, 2, "不同节点各自引用时先各自登记");
  const unique = uniqueMissionSources(raw);
  assert.equal(unique.length, 1, "对外只算一条，不能靠重复引用把证据条数刷上去");
  assert.equal(unique[0]?.sourceId, "dup");
});

test("节点重跑后旧引用作废，迟到的旧任务引用也不计入本次来源", () => {
  const sources = uniqueMissionSources(
    collectMissionSources([
      cite({ id: "e1", seq: 1, nodeKey: "market", sourceId: "old", url: "https://example.com/old", taskId: "task-1" }),
      missionEvent("node.rerun", "market"),
      missionEvent("node.started", "market", { taskId: "task-2" }),
      cite({ id: "e3", seq: 3, nodeKey: "market", sourceId: "fresh", url: "https://example.com/fresh", taskId: "task-2" }),
      cite({ id: "e4", seq: 4, nodeKey: "market", sourceId: "stale", url: "https://example.com/stale", taskId: "task-1" }),
    ]),
  );
  assert.deepEqual(sources.map((s) => s.sourceId), ["fresh"], "重跑前的材料与迟到返回的旧任务材料都不能算本次来源");
});

test("快照与哈希不自洽的引用不算来源：来路不明的材料不进证据", () => {
  const forged = cite({ id: "e1", seq: 1, nodeKey: "market", sourceId: "forged", url: "https://example.com/forged" });
  forged.payload.contentHash = "deadbeef";
  const real = cite({ id: "e2", seq: 2, nodeKey: "market", sourceId: "real", url: "https://example.com/real" });
  assert.deepEqual(uniqueMissionSources(collectMissionSources([forged, real])).map((s) => s.sourceId), ["real"]);
});

test("多来源给出矛盾数字、结论又下确定性判断 → 降级并提示写明口径差异", () => {
  const report: MissionReport = {
    ...compliantReport(),
    researchSources: CONFLICT_SOURCES,
    conclusion: `${conflictConclusion()}
- 数据显示：复购率已核实，赛道可以确认。`,
  };
  const quality = assessMissionReportQuality(report);
  assert.equal(report.researchSources?.length, 2, "矛盾材料不能因为内容打架被悄悄删掉");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-CONFLICT"), `应命中多来源口径规则：${JSON.stringify(quality.issues)}`);
  assert.equal(quality.status, "DRAFT_UNVERIFIED");
});

test("矛盾已如实写进缺口清单时不再判多来源问题：限制已反映在结论里", () => {
  const report: MissionReport = {
    ...compliantReport(),
    researchSources: CONFLICT_SOURCES,
    conclusion: `${conflictConclusion("- UNKNOWN：两份材料的复购率口径不一致（需要统一统计口径后重新抽样）。")}
- 数据显示：赛道可以确认。`,
  };
  const quality = assessMissionReportQuality(report);
  assert.ok(!quality.issues.some((issue) => issue.rule === "R-CONFLICT"), `已披露差异就不该再降级：${JSON.stringify(quality.issues)}`);
  assert.equal(quality.status, "DELIVERABLE", `已披露差异应放行，实际命中：${JSON.stringify(quality.issues)}`);
});

