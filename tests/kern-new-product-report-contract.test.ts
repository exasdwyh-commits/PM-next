import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONCLUSION_FORMAT_VERSION,
  NEW_PRODUCT_CONCLUSION_SECTIONS,
  REPORT_CLAIM_MARKS,
  SPECIALIST_EVIDENCE_RULE,
  buildNewProductConclusionContract,
  validateNewProductConclusion,
} from "../src/modules/supervisor/report-contract";
import { buildNewProductMissionPlan } from "../src/modules/supervisor/plan";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_HEADINGS = [
  "结论摘要",
  "产品定位",
  "成本与经济性",
  "销售机制与渠道",
  "营销策略",
  "风险评估",
  "合规边界",
  "验证计划与待决策",
];

function buildCompliantReport(): string {
  return [
    "## 结论摘要",
    "推荐做「晚安饮」方向（推断）。主推日夜分时场景而非助眠宣称，理由是宣称红区清晰可规避。",
    "**结论与建议**：不做医疗助眠宣称，定位功能性饮料方向（推断）。",
    "## 产品定位",
    "25–40 岁一线城市女性、晚间睡前两小时场景；不做药感包装（推断）。",
    "## 成本与经济性",
    "六类成本里原材料与平台佣金占比预计前二（推断）；真实 BOM 与起订量暂时没有报价：",
    "- UNKNOWN：单瓶原材料成本（需要 2–3 家供应商的真实报价）",
    "## 销售机制与渠道",
    "小红书内容种草 → 天猫货架成交的组合作为最小验证（推断），线下外卖柜渠道事实依据不足：",
    "- UNKNOWN：线下渠道转化率（需要 14 天小规模试摆数据）",
    "## 营销策略",
    "以「下班切频道」为核心信息做冷启动（推断）。",
    "## 风险评估",
    "主要风险：助眠概念被平台限流（推断），触发条件为内容命中医疗词库。",
    "## 合规边界",
    "普通食品不得宣称改善睡眠等功效（事实），宣称边界以《广告法》第 17 条为硬约束。",
    "## 验证计划与待决策",
    "首个验证假设：晚安场景点击转化率显著高于日常场景（推断）。",
    "**需要你决定**：是否先投入 1 万元做 14 天内容验证。",
    "",
  ].join("\n");
}

test("R1-A：八节契约完整且与既有解析约定兼容", () => {
  assert.equal(NEW_PRODUCT_CONCLUSION_SECTIONS.length, 8);
  assert.deepEqual(NEW_PRODUCT_CONCLUSION_SECTIONS.map((s) => s.heading), EXPECTED_HEADINGS);

  const ids = new Set(NEW_PRODUCT_CONCLUSION_SECTIONS.map((s) => s.id));
  assert.equal(ids.size, NEW_PRODUCT_CONCLUSION_SECTIONS.length, "section id 必须唯一");

  for (const s of NEW_PRODUCT_CONCLUSION_SECTIONS) {
    assert.ok(s.scope.length >= 16, `${s.id} 缺少口径说明`);
    assert.ok(s.sourcedFrom.length >= 1, `${s.id} 缺少来源标注`);
    assert.ok(/^[^。.!?！？]+$/.test(s.heading), `${s.heading} 标题不带句读（渲染层识别约束）`);
  }

  assert.deepEqual([...REPORT_CLAIM_MARKS], ["事实", "推断", "UNKNOWN"]);
  assert.equal(CONCLUSION_FORMAT_VERSION, "new-product-conclusion/v1");

  // 特殊解析约定：风险节标题必须含「风险」（envelopeFromMission 决策卡取料正则）。
  assert.ok(NEW_PRODUCT_CONCLUSION_SECTIONS.some((s) => /风险/.test(s.heading)));
});

test("R1-B：标准样例通过校验；契据文本自带全部约束", () => {
  const v = validateNewProductConclusion(buildCompliantReport());
  assert.deepEqual(v.problems, [], `样例报告应通过校验：${v.problems.join("；")}`);
  assert.ok(v.ok);

  const contract = buildNewProductConclusionContract();
  for (const heading of EXPECTED_HEADINGS) {
    assert.ok(contract.includes(`## ${heading}`), `契约提示必须点名 ## ${heading}`);
  }
  for (const anchor of ["（事实）", "（推断）", "（UNKNOWN）", "严禁编造", "需要你决定", "结论与建议", "UNKNOWN："]) {
    assert.ok(contract.includes(anchor), `契约提示缺少锚点「${anchor}」`);
  }

  // 专家节点标注纪律：末尾缺口行格式与 from-mission.ts extractUnknowns 的解析一致。
  assert.ok(SPECIALIST_EVIDENCE_RULE.includes("UNKNOWN：<缺什么>（需要 <如何补齐"));
  for (const mark of REPORT_CLAIM_MARKS) {
    assert.ok(SPECIALIST_EVIDENCE_RULE.includes(`（${mark}）`), `标注纪律缺少（${mark}）`);
  }
});

test("R1-C：缺节、缺标注、缺拍板行都会被指出，而不是放行", () => {
  const ok = buildCompliantReport();

  const noCompliance = ok.replace(/## 合规边界[\s\S]*?## 验证计划与待决策/, "## 验证计划与待决策");
  assert.ok(validateNewProductConclusion(noCompliance).problems.some((p) => p.includes("## 合规边界")));

  const noMarks = validateNewProductConclusion(ok.replace(/（事实）|（推断）|（UNKNOWN）/g, ""));
  assert.ok(noMarks.problems.some((p) => p.includes("标注")));

  const noDecision = validateNewProductConclusion(ok.replace("**需要你决定**：是否先投入 1 万元做 14 天内容验证。", "没有待办。"));
  assert.ok(noDecision.problems.some((p) => p.includes("需要你决定")));

  const noRecLine = validateNewProductConclusion(ok.replace(/\*\*结论与建议\*\*：.*\n/, ""));
  assert.ok(noRecLine.problems.some((p) => p.includes("结论与建议")));

  assert.ok(!validateNewProductConclusion("").ok, "空文本必须不合规");
});

test("R1-D：新产品 mission 的 synthesis 目标携带完整契约；generic 路径不受影响", () => {
  const plan = buildNewProductMissionPlan("给 30 岁城市女性开发一款助眠晚安饮");
  const synthesis = plan.nodes.find((n) => n.key === "synthesis");
  assert.ok(synthesis, "新产品 mission 必须有 synthesis 节点");
  for (const heading of EXPECTED_HEADINGS) {
    assert.ok(synthesis.objective.includes(`## ${heading}`), `synthesis 目标缺少 ## ${heading}`);
  }
  assert.ok(synthesis.objective.includes(CONCLUSION_FORMAT_VERSION));
  assert.ok(synthesis.objective.includes("推荐做「"), "保留 extractRecommendation 兼容锚点");

  // generic 汇总提示不得被新产品契约污染（fs 只读接线证据）。
  const executorSrc = fs.readFileSync(path.join(ROOT, "src/modules/supervisor/generic-executor.ts"), "utf8");
  assert.ok(executorSrc.includes("buildNewProductConclusionContract()"), "generic-executor 需引入契约构造函数");
  assert.ok(executorSrc.includes('input.missionPlaybook === "NEW_PRODUCT"'), "generic-executor 需按 playbook 切换汇总契约");
  assert.ok(executorSrc.includes("parentPlan?.playbook"), "generic-executor 需从 parent snapshot 读取 playbook");
  assert.ok(executorSrc.includes("SPECIALIST_EVIDENCE_RULE"), "专家节点指令需接入标注纪律");
});
