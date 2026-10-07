import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { buildOfficeReport, keyPoints, markdownBlocks, plainInline, pptxPlan, reportTables, xlsxPlan } from "../src/modules/supervisor/office-export";
import type { MissionReport } from "../src/modules/supervisor/report-format";

const report: MissionReport = {
  missionTaskId: "m1",
  title: "智能宠物喂食器",
  goal: "我想开发一个智能宠物喂食器",
  status: "SUCCEEDED",
  outcome: "COMPLETED",
  demo: true,
  createdAt: "2026-09-28T08:00:00.000Z",
  constraints: [{ question: "目标价位", answer: "200 元以内" }],
  conclusion: "## 推荐\n推荐**方向 A**：多猫家庭。理由见下。\n\n- 需求明确\n- 竞品价格带 199–399\n\n| 方向 | 毛利 | 风险 |\n|---|---|---|\n| A | 42 | 中 |\n| B | 30 | 低 |\n\n```kern-artifact\n{\"x\":1}\n```",
  decision: "是否接受 60 天验证期？",
  recommendation: "先做方向 A 的预售验证",
  steps: [
    { key: "market", label: "市场研究", agent: "研究员", status: "SUCCEEDED", output: "### 规模\n市场约 50 亿元。增长 12%。\n1. 小佩 299 元\n2. 霍曼 199 元" },
    { key: "gtm", label: "上市营销", agent: "营销", status: "SKIPPED", output: null },
  ],
  meta: { tasksCreated: 9, maxTasks: 16, memoriesUsed: ["预算 50 万"], successCriteria: [], humanGates: [] },
};

test("OX1：Markdown 解析为块（标题 / 列表 / 表格 / 跳过代码块）", () => {
  const b = markdownBlocks(report.conclusion!);
  assert.deepEqual(b.map((x) => x.kind), ["heading", "para", "bullet", "bullet", "table"]);
  assert.equal((b[1] as { text: string }).text, "推荐方向 A：多猫家庭。理由见下。");
  assert.deepEqual((b[4] as { rows: string[][] }).rows, [["A", "42", "中"], ["B", "30", "低"]]);
  assert.equal(plainInline("见 [官网](https://x.com) 与 `code`"), "见 官网 与 code");
});

test("OX2：各格式的内容规划", () => {
  assert.equal(reportTables(report).length, 1);
  const x = xlsxPlan(report);
  assert.ok(x.overview.some(([k, v]) => k === "说明" && /演示数据/.test(v)));
  assert.equal(x.steps.length, 2);
  const slides = pptxPlan(report);
  assert.deepEqual(slides.map((s) => s.title), ["结论", "建议与待你决定", "市场研究 · 完成", "上市营销 · 已跳过"]);
  assert.deepEqual(keyPoints(report.steps[0].output), ["小佩 299 元", "霍曼 199 元", "市场约 50 亿元。"]);
});

test("OX3：DOCX 生成并回读（含表格、演示标注）", async () => {
  const { buffer, check } = await buildOfficeReport(report, "docx");
  assert.equal(check.sha256.length, 64);
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
  assert.match(xml, /智能宠物喂食器/);
  assert.match(xml, /演示数据/);
  assert.doesNotMatch(xml, /kern-artifact/);
  assert.equal(check.detail.tables, 1);
});

test("OX4：XLSX 生成并回读（概览 / 步骤 / 表格页，数字保持数字）", async () => {
  const { buffer, check } = await buildOfficeReport(report, "xlsx");
  assert.deepEqual(Object.keys(check.detail), ["概览", "步骤", "结论-表1"]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const t = wb.getWorksheet("结论-表1")!;
  assert.equal(t.getCell("B2").value, 42);
  assert.equal(t.getCell("A1").value, "方向");
});

test("OX5：PPTX 生成并回读（封面 + 每页一个主题）", async () => {
  const { buffer, check } = await buildOfficeReport(report, "pptx");
  assert.equal(check.detail.slides, 5);
  const zip = await JSZip.loadAsync(buffer);
  const s3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
  assert.match(s3, /建议与待你决定/);
});
