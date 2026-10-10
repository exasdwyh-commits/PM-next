import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_DEVELOPMENT_REPORT_FORMAT,
  REPORT_OUTPUT_CONTRACT,
  buildExecutiveSummary,
  buildReportSection,
  estimateMaxOutputTokens,
  fitTextToBudget,
  validateReportSections,
  type ReportSection,
} from "../src/modules/visual-intelligence/report-format";

test("开品报告格式包含固定章节且 id 唯一、预算自洽", () => {
  const ids = PRODUCT_DEVELOPMENT_REPORT_FORMAT.sections.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 10);
  for (const spec of PRODUCT_DEVELOPMENT_REPORT_FORMAT.sections) {
    assert.ok(spec.title.length > 0, `${spec.id} 缺少标题`);
    assert.ok(spec.budget.summaryMaxChars > 0, `${spec.id} 摘要预算必须为正`);
    assert.ok(
      spec.budget.detailMaxChars >= spec.budget.detailItemMaxChars,
      `${spec.id} 细节总预算不得小于单条预算`,
    );
    assert.ok(spec.budget.maxDetailItems > 0, `${spec.id} 细节条数上限必须为正`);
  }
  assert.ok(PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars >= 4000);
  assert.ok(
    PRODUCT_DEVELOPMENT_REPORT_FORMAT.recommendedMaxOutputTokens >=
      Math.ceil(PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars / 1.5),
    "maxTokens 建议值必须覆盖正文粗略估算",
  );
});

test("fitTextToBudget 预算内原样返回，超出时在句边界截断", () => {
  assert.equal(fitTextToBudget("短句。", 10), "短句。");
  const long = "第一句很长。第二句也很长！第三句继续。";
  const fitted = fitTextToBudget(long, 12);
  assert.ok(fitted.endsWith("…"));
  assert.ok(fitted.length <= 12);
  assert.ok(fitted.startsWith("第一句"));
  assert.equal(fitTextToBudget("abcdefghij", 5), "abcd…");
  assert.equal(fitTextToBudget("任何内容", 0), "");
  assert.equal(fitTextToBudget("  带空白的句子。  ", 100), "带空白的句子。");
});

test("buildReportSection 收敛摘要与细节到预算", () => {
  const spec = PRODUCT_DEVELOPMENT_REPORT_FORMAT.sections.find((item) => item.id === "compliance");
  assert.ok(spec);
  const section = buildReportSection(
    spec,
    "很长很长的摘要。".repeat(30),
    ["细节一。", "细节二。".repeat(40), "细节三。", "细节四。", "细节五。", "细节六。"],
  );
  assert.ok(section.summary.length <= spec.budget.summaryMaxChars);
  assert.ok(section.details.length <= spec.budget.maxDetailItems);
  const total = section.details.reduce((sum, detail) => sum + detail.length, 0);
  assert.ok(total <= spec.budget.detailMaxChars);
  for (const detail of section.details) {
    assert.ok(detail.length <= spec.budget.detailItemMaxChars);
  }
});

test("validateReportSections 检查必需章节与预算", () => {
  const good: ReportSection[] = PRODUCT_DEVELOPMENT_REPORT_FORMAT.sections.map((spec) =>
    buildReportSection(spec, `${spec.title}摘要。`, [`${spec.title}细节。`]),
  );
  assert.ok(validateReportSections(good).ok);

  const missing = good.filter((section) => section.id !== "roadmap");
  const missingResult = validateReportSections(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.problems.some((problem) => problem.includes("roadmap")));

  const over: ReportSection[] = good.map((section) =>
    section.id === "compliance" ? { ...section, summary: "超".repeat(500) } : section,
  );
  const overResult = validateReportSections(over);
  assert.equal(overResult.ok, false);
  assert.ok(overResult.problems.some((problem) => problem.includes("摘要超预算")));

  const duplicated: ReportSection[] = [...good, good[0]];
  assert.ok(validateReportSections(duplicated).problems.some((problem) => problem.includes("重复")));
});

test("buildExecutiveSummary 汇总必需章节摘要并守预算", () => {
  const sections: ReportSection[] = PRODUCT_DEVELOPMENT_REPORT_FORMAT.sections.map((spec) =>
    buildReportSection(spec, `${spec.title}一句话摘要。`, []),
  );
  const summary = buildExecutiveSummary(sections);
  assert.ok(summary.length <= PRODUCT_DEVELOPMENT_REPORT_FORMAT.summaryLayerMaxChars);
  assert.ok(summary.includes("成本结构与盈利模型"));
  assert.ok(!summary.includes("竞品格局与差异化"), "可选章节不进入执行摘要层");
  assert.ok(!summary.includes("Token 与成本统计"), "可选章节不进入执行摘要层");
});

test("estimateMaxOutputTokens 单调且覆盖估算，输出契约约束生成端", () => {
  assert.ok(estimateMaxOutputTokens(0) >= 1024);
  assert.ok(estimateMaxOutputTokens(8000) >= Math.ceil(8000 / 1.5));
  assert.ok(estimateMaxOutputTokens(16000) > estimateMaxOutputTokens(8000));
  assert.ok(REPORT_OUTPUT_CONTRACT.includes("执行摘要"));
  assert.ok(REPORT_OUTPUT_CONTRACT.includes("待填写"));
  assert.ok(REPORT_OUTPUT_CONTRACT.includes("maxTokens"));
  assert.ok(
    REPORT_OUTPUT_CONTRACT.includes(String(PRODUCT_DEVELOPMENT_REPORT_FORMAT.recommendedMaxOutputTokens)),
  );
  assert.ok(REPORT_OUTPUT_CONTRACT.includes(String(PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars)));
});
