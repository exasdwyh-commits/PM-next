import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_STAGES, prepareArtifactSubmission, preparePacketBudget, projectStagesForMode } from "../src/app/projects/[id]/project-workspace";

test("交付成果不以默认占位文字替代空输入", () => {
  for (const [title, content] of [["报告", ""], ["报告", "  "], ["", "已完成的报告"], ["  ", "报告内容"]]) {
    assert.throws(() => prepareArtifactSubmission(title, content, false), /实际成果内容/);
  }
});

test("提交保留用户成果并去除首尾空白", () => {
  assert.deepEqual(prepareArtifactSubmission("  实测报告 ", "\n 测试结果：12 mg \n", false), {
    title: "实测报告", content: "测试结果：12 mg",
  });
});

test("结构化成果只接受有效 JSON 对象", () => {
  for (const content of ["broken", "null", "[]", "12", '"报告"']) {
    assert.throws(() => prepareArtifactSubmission("报价", content, true), /JSON/);
  }
  const content = '{"dataNature":"DEMO","unitPrice":10}';
  assert.equal(prepareArtifactSubmission("报价", content, true).content, content);
});

test("预算拒绝空白、非数值与非正数，允许实际小数预算", () => {
  for (const value of ["", " ", "abc", "Infinity", "0", "-12", "12 元"]) {
    assert.throws(() => preparePacketBudget(value), /预算金额/);
  }
  assert.equal(preparePacketBudget("1234.56"), 1234.56);
});

test("项目阶段包含实际交付终态", () => {
  assert.equal(PROJECT_STAGES.indexOf("DELIVERED"), PROJECT_STAGES.length - 1);
});

test("指定产品从生产准备开始，不把跳过的新品研发阶段显示成已走过", () => {
  assert.deepEqual(projectStagesForMode("FIXED_PRODUCT"), ["PRODUCTION_PREP", "PRODUCTION", "DELIVERED"]);
  assert.deepEqual(projectStagesForMode("NEW_PRODUCT"), PROJECT_STAGES);
});
