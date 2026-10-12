/**
 * KX-32 往返（C6）：办公文件回写与新写 —— 在不丢原文的前提下追加分析。
 * ==================================================================
 *
 * 三个动作：
 * 1) appendAnalysisToXlsx：给已有 xlsx 追加一个分析 sheet（可带表格与公式），
 *    原有 sheet 与数据逐行核对后才返回；原数据被改动直接报错。
 * 2) appendAnalysisToDocx：给已有 docx 在正文末尾追加一节（标题 + 段落 + 可选表格），
 *    走 document.xml 级别插入（docx 库不支持回载编辑），原有文本必须全部保留。
 * 3) buildAnalysisWorkbook：从零写一个分析工作簿：数据表 + 合计公式行 + 柱状图。
 *    exceljs 没有图表 API，图表按 OOXML 规范手工注入（chart/drawing/rels/content-types），
 *    并带数据缓存（strCache/numCache），不依赖打开方重算才有数。
 *
 * 共同纪律（沿用 office-export 的回读校验）：写完必回读、核对、算 SHA-256，
 * 不一致就抛错，不把坏文件交出去。pptx 往返本期未做（见 PR 说明）。
 */
import { createHash } from "node:crypto";
import { parseDocx, parseXlsx } from "./office-import";
import { verifyOffice } from "./office-export";

export type AnalysisTable = { header: string[]; rows: (string | number)[][] };

export type AnalysisSection = {
  /** 分析节标题（xlsx 里同时是新 sheet 名的来源，docx 里是一级标题）。 */
  title: string;
  lines?: string[];
  table?: AnalysisTable;
  /** 仅 xlsx：写到分析 sheet 指定单元格的公式，如 { cell: "F2", formula: "AVERAGE(报价!C2:C4)" }。 */
  formulas?: { cell: string; formula: string }[];
};

export type RoundtripCheck = {
  format: "xlsx" | "docx";
  sha256: string;
  bytes: number;
  /** xlsx：各 sheet 行数；docx：段落/表格数（与 office-export verifyOffice 同口径）。 */
  detail: Record<string, number>;
};

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** sheet 名唯一化（office-export 内部有一个同名 helper 未导出，这里按同规则本地实现）。 */
function uniqueSheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "分析";
  let name = clean;
  for (let k = 2; used.has(name); k++) name = `${clean.slice(0, 26)}-${k}`;
  used.add(name);
  return name;
}

function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

// ───────── XLSX 回写：追加分析 sheet ─────────

export async function appendAnalysisToXlsx(
  buffer: Buffer,
  section: AnalysisSection
): Promise<{ buffer: Buffer; check: RoundtripCheck; sheetName: string }> {
  const before = await parseXlsx(buffer);
  const beforeCounts = new Map(before.sheets.map((s) => [s.name, s.header.length || s.rows.length ? 1 + s.rows.length : 0]));

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const used = new Set(wb.worksheets.map((ws) => ws.name));
  const name = uniqueSheetName(section.title, used);
  const ws = wb.addWorksheet(name);
  ws.getCell("A1").value = section.title;
  ws.getCell("A1").font = { bold: true, size: 14 };
  let row = 2;
  for (const line of section.lines ?? []) {
    ws.getCell(`A${row}`).value = line;
    row += 1;
  }
  if (section.table) {
    row += 1;
    const headAt = row;
    section.table.header.forEach((h, i) => (ws.getCell(`${columnLetter(i + 1)}${row}`).value = h));
    ws.getRow(headAt).font = { bold: true };
    row += 1;
    for (const r of section.table.rows) {
      r.forEach((v, i) => (ws.getCell(`${columnLetter(i + 1)}${row}`).value = v));
      row += 1;
    }
  }
  for (const f of section.formulas ?? []) {
    ws.getCell(f.cell).value = { formula: f.formula };
  }
  ws.columns.forEach((c) => (c.width = 22));

  const out = Buffer.from(await wb.xlsx.writeBuffer());

  // 回读核对：原 sheet 一个不能少、行数不能变（解析口径 = 表头 + 数据行）；新 sheet 与公式必须在。
  const after = await parseXlsx(out);
  const afterByName = new Map(after.sheets.map((s) => [s.name, s]));
  for (const [sheet, count] of beforeCounts) {
    const got = afterByName.get(sheet);
    if (!got) throw new Error(`XLSX 回写后原 sheet 丢失：${sheet}`);
    const gotCount = (got.header.length || got.rows.length ? 1 : 0) + got.rows.length;
    if (gotCount !== count) throw new Error(`XLSX 回写后原 sheet 行数变化：${sheet} ${count} → ${gotCount}`);
  }
  if (!afterByName.has(name)) throw new Error(`XLSX 回写后分析 sheet 缺失：${name}`);
  if (section.formulas?.length) {
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(out as unknown as ArrayBuffer);
    const ws2 = wb2.getWorksheet(name)!;
    for (const f of section.formulas) {
      const v = ws2.getCell(f.cell).value as { formula?: string } | null;
      if (!v || typeof v !== "object" || v.formula !== f.formula) {
        throw new Error(`XLSX 回写后公式不一致：${name}!${f.cell}`);
      }
    }
  }
  const detail = Object.fromEntries(after.sheets.map((s) => [s.name, (s.header.length || s.rows.length ? 1 : 0) + s.rows.length]));
  return { buffer: out, sheetName: name, check: { format: "xlsx", sha256: sha256(out), bytes: out.length, detail } };
}

// ───────── DOCX 回写：正文末尾追加一节 ─────────

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const RUN_FONT = `<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/></w:rPr>`;

function paraXml(text: string, headingLevel = 0): string {
  const pPr = headingLevel > 0 ? `<w:pPr><w:pStyle w:val="Heading${headingLevel}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${RUN_FONT}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function runFont(bold: boolean): string {
  // w:b 是 run 属性，必须在 w:rPr 内、且 rPr 必须是 w:r 的第一个子元素。
  return `<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>${bold ? "<w:b/>" : ""}</w:rPr>`;
}

function tableXml(table: AnalysisTable): string {
  const borders =
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
    ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join("") +
    `</w:tblBorders></w:tblPr>`;
  const rowXml = (cells: (string | number)[], bold: boolean) =>
    `<w:tr>${cells
      .map(
        (c) =>
          `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r>${runFont(bold)}<w:t xml:space="preserve">${xmlEscape(String(c))}</w:t></w:r></w:p></w:tc>`
      )
      .join("")}</w:tr>`;
  return `<w:tbl>${borders}${rowXml(table.header, true)}${table.rows.map((r) => rowXml(r, false)).join("")}</w:tbl>`;
}

export async function appendAnalysisToDocx(
  buffer: Buffer,
  section: AnalysisSection
): Promise<{ buffer: Buffer; check: RoundtripCheck }> {
  const before = await parseDocx(buffer);
  const beforeTexts = before.blocks.map((b) => (b.kind === "table" ? b.header.join(" ") : b.text));

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("DOCX 缺少 word/document.xml，不是有效文档");
  const xml = await file.async("string");

  const insert =
    paraXml(section.title, 1) +
    (section.lines ?? []).map((l) => paraXml(l)).join("") +
    (section.table ? tableXml(section.table) : "");
  // sectPr 是 body 的最后一个子元素，分析节必须插在它之前；没有 sectPr 就插在 </w:body> 前。
  const sectAt = xml.indexOf("<w:sectPr");
  const outXml = sectAt >= 0 ? xml.slice(0, sectAt) + insert + xml.slice(sectAt) : xml.replace("</w:body>", insert + "</w:body>");
  if (outXml === xml) throw new Error("DOCX 正文锚点未找到（sectPr / </w:body> 均缺失），拒绝回写");
  zip.file("word/document.xml", outXml);
  const out = await zip.generateAsync({ type: "nodebuffer" });

  // 回读核对：原文块一篇不能少（文本逐块在），分析标题必须在。
  const after = await parseDocx(out);
  const afterTexts = new Set(after.blocks.map((b) => (b.kind === "table" ? b.header.join(" ") : b.text)));
  for (const t of beforeTexts) {
    if (t && !afterTexts.has(t)) throw new Error(`DOCX 回写后原文丢失：${t.slice(0, 40)}`);
  }
  if (!afterTexts.has(section.title)) throw new Error("DOCX 回写后分析标题缺失");
  const detail = await verifyOffice("docx", out);
  return { buffer: out, check: { format: "docx", sha256: sha256(out), bytes: out.length, detail } };
}

// ───────── 新写：分析工作簿（公式 + 柱状图） ─────────

export type AnalysisWorkbookInput = {
  title: string;
  sheetName?: string;
  header: string[];
  rows: (string | number)[][];
  /** 合计行：在该列（1 起）对数据行写 SUM 公式，标签落在第一列。 */
  totalColumn?: number;
  /** 柱状图：类目取第一列，数值取该列（1 起）。 */
  chartColumn?: number;
  chartTitle?: string;
};

/** exceljs 无图表 API：按 OOXML 规范把 chart / drawing / rels / content-types 注入成品 zip。 */
async function injectBarChart(
  buffer: Buffer,
  opts: { sheetName: string; sheetFile: string; firstDataRow: number; lastDataRow: number; categoryColumn: number; valueColumn: number; title: string; categories: string[]; values: number[] }
): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const q = `'${opts.sheetName.replace(/'/g, "''")}'`;
  const catRef = `${q}!$${columnLetter(opts.categoryColumn)}$${opts.firstDataRow}:$${columnLetter(opts.categoryColumn)}$${opts.lastDataRow}`;
  const valRef = `${q}!$${columnLetter(opts.valueColumn)}$${opts.firstDataRow}:$${columnLetter(opts.valueColumn)}$${opts.lastDataRow}`;
  const nameRef = `${q}!$${columnLetter(opts.valueColumn)}$${opts.firstDataRow - 1}`;
  const strCache = `<c:strCache><c:ptCount val="${opts.categories.length}"/>${opts.categories
    .map((c, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(c)}</c:v></c:pt>`)
    .join("")}</c:strCache>`;
  const numCache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${opts.values.length}"/>${opts.values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)
    .join("")}</c:numCache>`;
  const chartXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xmlEscape(opts.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${xmlEscape(nameRef)}</c:f></c:strRef></c:tx>` +
    `<c:cat><c:strRef><c:f>${xmlEscape(catRef)}</c:f>${strCache}</c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${xmlEscape(valRef)}</c:f>${numCache}</c:numRef></c:val></c:ser>` +
    `<c:gapWidth val="150"/><c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>` +
    `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>` +
    `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="111111111"/></c:valAx>` +
    `</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
  const drawingXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${opts.lastDataRow + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${opts.lastDataRow + 17}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="KernChart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>` +
    `<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  zip.file("xl/charts/chart1.xml", chartXml);
  zip.file("xl/drawings/drawing1.xml", drawingXml);
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`
  );
  // sheet 侧：加 drawing 关系并在 sheetData 后挂 <drawing>。
  const relsPath = `xl/worksheets/_rels/${opts.sheetFile.split("/").pop()}.rels`;
  const relId = "rIdKernDrawing";
  const relEntry = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`;
  const oldRels = await zip.file(relsPath)?.async("string");
  zip.file(
    relsPath,
    oldRels
      ? oldRels.replace("</Relationships>", relEntry + "</Relationships>")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntry}</Relationships>`
  );
  const sheetXml = await zip.file(opts.sheetFile)!.async("string");
  if (!sheetXml.includes("</sheetData>")) throw new Error("图表注入失败：sheetData 锚点缺失");
  zip.file(opts.sheetFile, sheetXml.replace("</sheetData>", `</sheetData><drawing r:id="${relId}"/>`));
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  zip.file(
    "[Content_Types].xml",
    ct.replace(
      "</Types>",
      `<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml+xml"/></Types>`
    )
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

export async function buildAnalysisWorkbook(
  input: AnalysisWorkbookInput
): Promise<{ buffer: Buffer; check: RoundtripCheck; sheetName: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kern";
  const used = new Set<string>();
  const name = uniqueSheetName(input.sheetName ?? "分析数据", used);
  const ws = wb.addWorksheet(name);
  ws.getCell("A1").value = input.title;
  ws.getCell("A1").font = { bold: true, size: 14 };
  input.header.forEach((h, i) => (ws.getCell(`${columnLetter(i + 1)}3`).value = h));
  ws.getRow(3).font = { bold: true };
  input.rows.forEach((r, ri) => {
    r.forEach((v, ci) => (ws.getCell(`${columnLetter(ci + 1)}${4 + ri}`).value = v));
  });
  const firstDataRow = 4;
  const lastDataRow = 3 + input.rows.length;
  let totalRowAt = 0;
  if (input.totalColumn) {
    totalRowAt = lastDataRow + 1;
    ws.getCell(`A${totalRowAt}`).value = "合计";
    ws.getCell(`A${totalRowAt}`).font = { bold: true };
    const col = columnLetter(input.totalColumn);
    ws.getCell(`${col}${totalRowAt}`).value = { formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})` };
    ws.getCell(`${col}${totalRowAt}`).font = { bold: true };
  }
  ws.columns.forEach((c) => (c.width = 22));
  // 显式标注为 Buffer（ArrayBufferLike 版）：JSZip generateAsync 的返回泛型与之不同，直接推断会让下面的注入赋值报 TS2322。
  let out: Buffer = Buffer.from(await wb.xlsx.writeBuffer());

  if (input.chartColumn) {
    // 定位数据 sheet 的部件路径（workbook.xml + rels 映射，不假设固定 sheet1.xml）。
    const JSZip = (await import("jszip")).default;
    const zip0 = await JSZip.loadAsync(out);
    const wbXml = await zip0.file("xl/workbook.xml")!.async("string");
    const wbRels = await zip0.file("xl/_rels/workbook.xml.rels")!.async("string");
    const sheetTag = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find((m) => m[1] === name);
    if (!sheetTag) throw new Error("图表注入失败：workbook.xml 未找到数据 sheet");
    const target = new RegExp(`<Relationship Id="${sheetTag[2]}"[^>]*Target="([^"]+)"`).exec(wbRels)?.[1];
    if (!target) throw new Error("图表注入失败：workbook rels 未找到 sheet 目标");
    const sheetFile = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    out = await injectBarChart(out, {
      sheetName: name,
      sheetFile,
      firstDataRow,
      lastDataRow,
      categoryColumn: 1,
      valueColumn: input.chartColumn,
      title: input.chartTitle ?? input.title,
      categories: input.rows.map((r) => String(r[0] ?? "")),
      values: input.rows.map((r) => Number(r[input.chartColumn! - 1]) || 0),
    });
  }

  // 回读核对：行数、合计公式、图表部件。
  const back = await parseXlsx(out);
  const sheet = back.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error("分析工作簿回读失败：数据 sheet 缺失");
  if (input.totalColumn) {
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(out as unknown as ArrayBuffer);
    const col = columnLetter(input.totalColumn);
    const v = wb2.getWorksheet(name)!.getCell(`${col}${totalRowAt}`).value as { formula?: string } | null;
    if (!v || v.formula !== `SUM(${col}${firstDataRow}:${col}${lastDataRow})`) throw new Error("分析工作簿回读失败：合计公式不一致");
  }
  if (input.chartColumn) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(out);
    if (!zip.file("xl/charts/chart1.xml") || !zip.file("xl/drawings/drawing1.xml")) {
      throw new Error("分析工作簿回读失败：图表部件缺失");
    }
  }
  const detail = Object.fromEntries(back.sheets.map((s) => [s.name, (s.header.length || s.rows.length ? 1 : 0) + s.rows.length]));
  return { buffer: out, sheetName: name, check: { format: "xlsx", sha256: sha256(out), bytes: out.length, detail } };
}
