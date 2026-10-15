import * as sharedQualityStore from "../src/shared/report-quality-store";
import * as compatibilityQualityStore from "../src/modules/supervisor/report-quality-store";
import { withReviewedContent } from "./helpers/report-content-fixture";
/**
 * 研究报告交付门禁回归（R1·report-quality/v1 · 交付侧）
 *
 * 锁住的是「正式文件能不能出去、以什么名义出去」，不是内部实现：
 * - 数字没有来源与口径 → 降级，不能当事实；
 * - 没有来源却称已核实 / 写零风险 → 降级；
 * - 阻断态（奶粉需求配海苔结论）任何格式都不出正式件（Office 分支此前绕过）；
 * - 草稿态出件必须带状态戳，正文带问题清单；
 * - 质量状态随内容指纹存档，内容一变旧判定即失效；读不到不伪造通过。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { assessMissionReportQuality, reportContentVersion, REPORT_QUALITY_VERSION } from "../src/modules/supervisor/report-quality";
import { planMissionDelivery } from "../src/modules/supervisor/report-delivery";
import { attachQuality, readQuality } from "../src/modules/supervisor/report-quality-store";
import { reportTitle, type MissionReport } from "../src/modules/supervisor/report-format";

const SHOT_GOAL =
  "好，其实我们想开发一款红参胶原蛋白肽女士奶粉，主打新疆三峰包奶源。目标人群35-55岁女性。预算大概10万以内。";

const baseMeta: MissionReport["meta"] = { tasksCreated: 6, maxTasks: 12, memoriesUsed: [], successCriteria: [], humanGates: [] };

const COMPLIANT_CONCLUSION = [
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
  const report = {
    playbook: "NEW_PRODUCT",
    missionTaskId: "mission/ok",
    title: reportTitle(SHOT_GOAL),
    goal: SHOT_GOAL,
    status: "SUCCEEDED",
    outcome: "COMPLETED",
    demo: false,
    createdAt: "2026-10-14T00:00:00Z",
    constraints: [],
    conclusion: COMPLIANT_CONCLUSION,
    decision: "是否在 10 万元以内启动首轮验证",
    recommendation: "红参胶原蛋白肽女士奶粉",
    steps: [{ key: "market", label: "市场", agent: "研究员", status: "SUCCEEDED", output: "## 市场判断\n- 需求稳定（事实）[source:s1]" }],
    researchSources: SOURCES,
    meta: baseMeta,
    ...over,
  } as MissionReport;
  return withReviewedContent(report, !report.demo);
}

test("可交付报告：三态与交付计划都不加戳、不加状态块", () => {
  const report = mk();
  const quality = assessMissionReportQuality(report);
  assert.equal(quality.status, "DELIVERABLE");
  const plan = planMissionDelivery(report);
  assert.equal(plan.blocked, false);
  assert.equal(plan.title, report.title);
  assert.deepEqual(plan.gate, []);
});

test("数字没有来源、单位口径或事实/推断标注 → 降级（R-NUMBER）", () => {
  const report = mk({ conclusion: `${COMPLIANT_CONCLUSION}\n- 复购率约 22%，高于品类均值。` });
  const quality = assessMissionReportQuality(report);
  assert.equal(quality.status, "DRAFT_UNVERIFIED");
  assert.ok(quality.issues.some((issue) => issue.rule === "R-NUMBER"), "应命中数字规则");
});

test("同一个数字补上来源与标注后不再被判为无依据", () => {
  const report = mk({ conclusion: `${COMPLIANT_CONCLUSION}\n- 复购率约 22%（推断，来源：某平台 2026Q3 抽样 1200 份）。` });
  const quality = assessMissionReportQuality(report);
  assert.ok(!quality.issues.some((issue) => issue.rule === "R-NUMBER"), `不应再命中数字规则：${JSON.stringify(quality.issues)}`);
});

test("没有来源却声称已核实 → 降级（R-EVIDENCE）", () => {
  const report = mk({ researchSources: [], conclusion: `${COMPLIANT_CONCLUSION}\n- 该结论已核实，可直接采用。` });
  const quality = assessMissionReportQuality(report);
  assert.ok(quality.issues.some((issue) => issue.rule === "R-EVIDENCE"), "应命中依据规则");
  assert.equal(quality.status, "DRAFT_UNVERIFIED");
});

test("证据不足时写「零风险」→ 降级（R-WORDING）", () => {
  const report = mk({ researchSources: [], conclusion: `${COMPLIANT_CONCLUSION}\n- 整体零风险。` });
  const quality = assessMissionReportQuality(report);
  assert.ok(quality.issues.some((issue) => issue.rule === "R-WORDING"), "应命中措辞规则");
});

test("奶粉需求配海苔结论：阻断，任何格式都不出正式件", () => {
  const report = mk({
    demo: true,
    researchSources: [],
    conclusion: "## 结论：推荐做「高蛋白海苔脆」（示例）\n同价位下蛋白含量领先约 40%，窗口期 6–9 个月。",
  });
  const quality = assessMissionReportQuality(report);
  assert.equal(quality.status, "BLOCKED");
  const plan = planMissionDelivery(report);
  assert.equal(plan.blocked, true);
  assert.match(plan.blockedReason, /不能作为正式研究交付/);
  assert.equal(plan.title, report.title, "阻断态不产出文件，标题不做草稿戳");
});

test("待补证草稿可以出件，但标题带状态戳、正文带问题清单", () => {
  const report = mk({ researchSources: [], conclusion: `${COMPLIANT_CONCLUSION}\n- 该结论已核实。` });
  const plan = planMissionDelivery(report);
  assert.equal(plan.blocked, false);
  assert.equal(plan.quality?.status, "DRAFT_UNVERIFIED");
  assert.match(plan.title, /^\[待补证草稿\] /);
  assert.ok(plan.gate.length >= 2, "正文头部应带状态块与问题清单");
  assert.ok(plan.gate.some((line) => line.includes("补齐方式")));
});

test("内容一变，指纹就变，旧判定自然失效", () => {
  const before = mk();
  const after = mk({ conclusion: `${COMPLIANT_CONCLUSION}\n- 补充一句结论（推断）。` });
  assert.notEqual(reportContentVersion(before), reportContentVersion(after));
});

test("质量状态存档：写进 Artifact 元数据后可原样读回", () => {
  const report = mk();
  const quality = assessMissionReportQuality(report);
  const content = attachQuality(JSON.stringify({ schemaVersion: "1.0", body: "x" }), quality, new Date("2026-10-14T10:00:00Z"));
  const stored = readQuality(content);
  assert.ok(stored, "应能读回存档");
  assert.equal(stored?.status, quality.status);
  assert.equal(stored?.contentVersion, quality.version);
});

test("存档与内容指纹不符 → 视为旧判定，返回 null（不伪造通过）", () => {
  const quality = assessMissionReportQuality(mk());
  const content = attachQuality(JSON.stringify({ schemaVersion: "1.0" }), quality);
  assert.equal(readQuality(content, "changed-fingerprint"), null);
});

test("历史报告没有检查记录 → 读回 null，接口据此提示尚未检查", () => {
  assert.equal(readQuality(JSON.stringify({ schemaVersion: "1.0", body: "x" })), null);
  assert.equal(readQuality("not-json"), null);
});

test("接线守卫：导出路由必须在 Office 分支之前跑门禁，并在阻断时终止", () => {
  const src = fs.readFileSync(new URL("../src/app/api/missions/[id]/export/route.ts", import.meta.url), "utf8");
  const gateAt = src.indexOf("planMissionDelivery(report)");
  const officeAt = src.indexOf("OFFICE.has(format)");
  assert.ok(gateAt > 0, "导出路由必须调用交付计划");
  assert.ok(officeAt > gateAt, "门禁必须排在 Office 分支之前（否则正式导出绕过检查）");
  assert.ok(/if \(plan\.blocked\)/.test(src), "阻断态必须终止交付");
  assert.ok(/X-Kern-Quality/.test(src), "非可交付件应带质量状态响应头");
});

/* ---------- 需求 §5：重复生成 / 交付请求（幂等） ---------- */

test("同一份报告重复请求交付：标题、正文与状态逐字一致，不产生第二份产物", () => {
  const report = mk({ researchSources: [], conclusion: `${COMPLIANT_CONCLUSION}
- 该结论已核实。` });
  const first = planMissionDelivery(report);
  const second = planMissionDelivery(report);
  assert.deepEqual(second, first, "重复请求必须拿到同一份交付计划");
});

test("同一内容重复存档：指纹与状态不变，判定记录只有一条", () => {
  const quality = assessMissionReportQuality(mk());
  const first = attachQuality(JSON.stringify({ schemaVersion: "1.0" }), quality, new Date("2026-10-14T10:00:00Z"));
  const second = attachQuality(first, quality, new Date("2026-10-14T11:00:00Z"));
  const stored = readQuality(second);
  assert.equal(stored?.contentVersion, quality.version, "重复存档不能改指纹");
  assert.equal(stored?.status, quality.status, "重复存档不能改状态");
  const keys = Object.keys(JSON.parse(second) as Record<string, unknown>).filter((key) => key === "quality");
  assert.equal(keys.length, 1, "重复存档不能堆出第二条判定");
});

test("阻断态重复请求：每次都不出件，原因与提示稳定一致（失败状态可恢复、不抖动）", () => {
  const blocked = () =>
    mk({
      demo: true,
      researchSources: [],
      conclusion: `## 结论：推荐做「高蛋白海苔脆」（示例）
同价位下蛋白含量领先约 40%。`,
    });
  const first = planMissionDelivery(blocked());
  const second = planMissionDelivery(blocked());
  assert.equal(first.blocked, true);
  assert.equal(second.blocked, true);
  assert.equal(second.blockedReason, first.blockedReason, "重复请求给出的阻断原因必须一致");
  assert.deepEqual(second.gate, first.gate);
});

/* ---------- 需求 §5：历史报告缺检查记录 ---------- */

test("历史报告没有检查记录：读回 null，且读取不改写原文", () => {
  const original = JSON.stringify({ schemaVersion: "1.0", body: "历史原文" });
  assert.equal(readQuality(original), null, "没有记录就是没检查过，不得伪造通过");
  assert.equal(original, JSON.stringify({ schemaVersion: "1.0", body: "历史原文" }), "原文必须逐字不变");
});

test("历史纯文本行：写质量状态时不改写原文，交由调用方决定如何处理", () => {
  const plain = "早期报告正文（不是 JSON）";
  assert.equal(attachQuality(plain, assessMissionReportQuality(mk())), plain, "不能把历史原文改得面目全非");
});

test("旧版本判定不算当前通过：schemaVersion 不一致 → null", () => {
  const legacy = JSON.stringify({
    schemaVersion: "1.0",
    quality: { schemaVersion: "report-quality/v0", status: "DELIVERABLE", contentVersion: "old", assessedAt: "2026-01-01T00:00:00Z", issues: [] },
  });
  assert.equal(readQuality(legacy), null, "旧判定不能冒充当前通过");
});

test("历史报告重新判定后写入当前状态与问题清单，不沿用旧结论", () => {
  const report = mk({ researchSources: [], conclusion: `${COMPLIANT_CONCLUSION}
- 该结论已核实。` });
  const quality = assessMissionReportQuality(report);
  assert.equal(quality.status, "DRAFT_UNVERIFIED");
  const stored = readQuality(attachQuality(JSON.stringify({ schemaVersion: "1.0" }), quality));
  assert.equal(stored?.status, "DRAFT_UNVERIFIED");
  assert.ok((stored?.issues.length ?? 0) > 0, "问题清单要随状态一起存档，界面才说得清原因");
});


test("shared-store: compatibility path re-exports the only implementation", () => {
  assert.equal(compatibilityQualityStore.attachQuality, sharedQualityStore.attachQuality);
  assert.equal(compatibilityQualityStore.readQuality, sharedQualityStore.readQuality);
});
test("shared-store: migration preserves the candidate v2 schema, never downgrades to donor v1", () => {
  assert.equal(sharedQualityStore.REPORT_QUALITY_SCHEMA_VERSION, "report-quality/v2");
  assert.equal(REPORT_QUALITY_VERSION, sharedQualityStore.REPORT_QUALITY_SCHEMA_VERSION);
  const q = { status: "DRAFT_UNVERIFIED" as const, version: "same-content", issues: [] };
  const content = sharedQualityStore.attachQuality("{}", q);
  const parsed = JSON.parse(content); parsed.quality.schemaVersion = "report-quality/v1";
  assert.equal(sharedQualityStore.readQuality(JSON.stringify(parsed)), null);
  assert.equal(sharedQualityStore.readQuality(content, "changed-content"), null);
});
test("shared-store: reader and writer agree without losing existing payload", () => {
  const quality = assessMissionReportQuality(mk());
  const original = { body: "keep original", sources: ["one"], unknowns: ["keep gap"] };
  const saved = attachQuality(JSON.stringify(original), quality, new Date("2026-10-15T00:00:00Z"));
  assert.deepEqual(readQuality(saved), sharedQualityStore.readQuality(saved));
  assert.equal(readQuality(saved)?.status, quality.status);
  const parsed = JSON.parse(saved); delete parsed.quality; assert.deepEqual(parsed, original);
});
test("shared-store: pure shared module never imports supervisor or a database", () => {
  const source = fs.readFileSync("src/shared/report-quality-store.ts", "utf8");
  assert.doesNotMatch(source, /from\s+["']@\/(?:modules|shared\/db)/);
  assert.equal(sharedQualityStore.readQuality("not JSON"), null);
  assert.equal(sharedQualityStore.readQuality("{}"), null);
});
