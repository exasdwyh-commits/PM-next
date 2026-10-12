import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { officeImportFormat, parseDocx, parseXlsx } from "../src/modules/supervisor/office-import";
import { appendAnalysisToDocx, appendAnalysisToXlsx, buildAnalysisWorkbook } from "../src/modules/supervisor/office-roundtrip";
import { buildOfficeReport } from "../src/modules/supervisor/office-export";
import type { MissionReport } from "../src/modules/supervisor/report-format";

// 竞品报价夹具：两个 sheet ——「报价」（表头 + 3 行报价）与「条款」（表头 + 2 行）。
async function competitorQuoteXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const q = wb.addWorksheet("报价");
  q.addRow(["竞品", "型号", "单价", "年费"]);
  q.addRow(["小佩", "PETKIT Pura", 299, 0]);
  q.addRow(["霍曼", "Homerunpet", 199, 99]);
  q.addRow(["鸟语花香", "BirdTalk F1", 259, 49]);
  const t = wb.addWorksheet("条款");
  t.addRow(["条款", "说明"]);
  t.addRow(["保修", "整机 1 年"]);
  t.addRow(["退货", "7 天无理由"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("RT1：格式判定只认 docx / xlsx", () => {
  assert.equal(officeImportFormat("竞品报价.XLSX"), "xlsx");
  assert.equal(officeImportFormat("方案.docx"), "docx");
  assert.equal(officeImportFormat("演示.pptx"), null);
  assert.equal(officeImportFormat("readme.md"), null);
});

test("RT2：xlsx 导入解析出 sheet / 表头 / 数据行，数字保持数字", async () => {
  const parsed = await parseXlsx(await competitorQuoteXlsx());
  assert.deepEqual(parsed.sheets.map((s) => s.name), ["报价", "条款"]);
  assert.deepEqual(parsed.sheets[0].header, ["竞品", "型号", "单价", "年费"]);
  assert.equal(parsed.sheets[0].rows.length, 3);
  assert.deepEqual(parsed.sheets[0].rows[0], ["小佩", "PETKIT Pura", 299, 0]);
  assert.equal(parsed.sheets[1].rows.length, 2);
});

test("RT3：xlsx 回写追加分析 sheet，原数据不丢、公式回读为公式", async () => {
  const src = await competitorQuoteXlsx();
  const { buffer, check, sheetName } = await appendAnalysisToXlsx(src, {
    title: "Kern 分析",
    lines: ["价格带 199–299，年费是主要差异项。"],
    table: { header: ["竞品", "单价"], rows: [["小佩", 299], ["霍曼", 199], ["鸟语花香", 259]] },
    formulas: [{ cell: "F2", formula: "AVERAGE(报价!C2:C4)" }],
  });
  assert.equal(check.sha256.length, 64);
  assert.equal(sheetName, "Kern 分析");

  const after = await parseXlsx(buffer);
  assert.deepEqual(after.sheets.map((s) => s.name), ["报价", "条款", "Kern 分析"]);
  // 原数据逐项核对
  const before = await parseXlsx(src);
  assert.deepEqual(after.sheets[0], before.sheets[0]);
  assert.deepEqual(after.sheets[1], before.sheets[1]);
  // 新分析 sheet 内容
  const analysis = after.sheets[2];
  assert.ok(analysis.rows.flat().includes("价格带 199–299，年费是主要差异项。"));
  assert.ok(analysis.rows.flat().includes("单价"));
  // 公式单元格回读必须是公式而不是被算成数值/丢弃
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const f = wb.getWorksheet("Kern 分析")!.getCell("F2").value as { formula?: string };
  assert.equal(f?.formula, "AVERAGE(报价!C2:C4)");
});

test("RT4：新写分析工作簿 —— 合计公式 + 柱状图部件齐全", async () => {
  const { buffer, check, sheetName } = await buildAnalysisWorkbook({
    title: "竞品单价对比",
    header: ["竞品", "单价"],
    rows: [["小佩", 299], ["霍曼", 199], ["鸟语花香", 259]],
    totalColumn: 2,
    chartColumn: 2,
    chartTitle: "竞品单价（元）",
  });
  assert.equal(check.sha256.length, 64);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(sheetName)!;
  // A1 标题、B3 表头、数据 4–6 行、B7 合计公式
  assert.equal(ws.getCell("A1").value, "竞品单价对比");
  const total = ws.getCell("B7").value as { formula?: string };
  assert.equal(total?.formula, "SUM(B4:B6)");
  const zip = await JSZip.loadAsync(buffer);
  const chart = await zip.file("xl/charts/chart1.xml")!.async("string");
  assert.match(chart, /<c:barChart>/);
  assert.match(chart, /竞品单价（元）/);
  assert.ok(zip.file("xl/drawings/drawing1.xml"));
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheetXml, /<drawing r:id="rIdKernDrawing"\/>/);
});

test("RT5：docx 导入解析出标题 / 段落 / 表格", async () => {
  const report: MissionReport = {
    missionTaskId: "m1",
    title: "智能宠物喂食器",
    goal: "我想开发一个智能宠物喂食器",
    status: "SUCCEEDED",
    outcome: "COMPLETED",
    demo: false,
    createdAt: "2026-09-28T08:00:00.000Z",
    constraints: [],
    conclusion: "## 推荐\n推荐方向 A。\n\n| 方向 | 毛利 |\n|---|---|\n| A | 42 |",
    decision: null,
    recommendation: "先做方向 A",
    steps: [],
    meta: { tasksCreated: 1, maxTasks: 16, memoriesUsed: [], successCriteria: [], humanGates: [] },
  };
  const { buffer } = await buildOfficeReport(report, "docx");
  const doc = await parseDocx(buffer);
  const texts = doc.blocks.map((b) => (b.kind === "table" ? b.header.join("/") : b.text));
  assert.ok(texts.some((t) => t.includes("智能宠物喂食器")), `标题应在解析结果里：${texts.join(" | ")}`);
  assert.ok(texts.some((t) => t.includes("推荐方向 A")));
  const tables = doc.blocks.filter((b) => b.kind === "table");
  assert.equal(tables.length, 1);
  assert.deepEqual((tables[0] as { header: string[] }).header, ["方向", "毛利"]);
});

test("RT6：docx 回写追加分析节，原文逐块保留", async () => {
  const report: MissionReport = {
    missionTaskId: "m2",
    title: "竞品报价评审",
    goal: "评审竞品报价",
    status: "SUCCEEDED",
    outcome: "COMPLETED",
    demo: false,
    createdAt: "2026-10-01T08:00:00.000Z",
    constraints: [],
    conclusion: "原结论：霍曼价格最低。",
    decision: null,
    recommendation: null,
    steps: [],
    meta: { tasksCreated: 1, maxTasks: 16, memoriesUsed: [], successCriteria: [], humanGates: [] },
  };
  const { buffer: src } = await buildOfficeReport(report, "docx");
  const before = await parseDocx(src);
  const { buffer, check } = await appendAnalysisToDocx(src, {
    title: "Kern 追加分析",
    lines: ["年费差异比单价差异更大，三年总成本需重算。"],
    table: { header: ["竞品", "三年总成本"], rows: [["霍曼", 496], ["小佩", 299]] },
  });
  assert.equal(check.sha256.length, 64);
  const after = await parseDocx(buffer);
  const texts = after.blocks.map((b) => (b.kind === "table" ? b.header.join("/") : b.text));
  for (const b of before.blocks) {
    const t = b.kind === "table" ? b.header.join("/") : b.text;
    assert.ok(texts.includes(t), `原文块回写后丢失：${t}`);
  }
  assert.ok(texts.includes("Kern 追加分析"));
  assert.ok(texts.some((t) => t.includes("三年总成本")));
});
