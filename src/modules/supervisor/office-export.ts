/**
 * KX-32 办公产出：把任务报告导出成 DOCX / XLSX / PPTX，并回读校验。
 * ==================================================================
 *
 * - 只在服务端路由里加载（体积大，不进客户端包）。
 * - 内容来源与「导出 MD」完全相同（MissionReport），结构先解析成通用块再各自渲染，
 *   所以三种格式与 MD 口径一致。
 * - 生成后立刻回读：计算 SHA-256，并重新解析文件核对段落 / 工作表行数 / 幻灯片页数，
 *   不一致直接报错，不把坏文件交给用户。
 * - P0 优化：重型库改为动态导入，按需加载，减少冷启动
 */
import { createHash } from "node:crypto";
import { isTableDivider, STATUS_LABEL, tableCells, type MissionReport } from "./report-format";

// 重型办公库改为动态导入（P0 安全优化：首包减小，按需加载）
// 原同步导入 docx/exceljs/pptxgenjs/jszip 合计 >7MB，改为函数内动态 import

export type OfficeFormat = "docx" | "xlsx" | "pptx";

export const OFFICE_MIME: Record<OfficeFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const FONT = "Microsoft YaHei";

// 步骤状态文案复用 report-format 的 STATUS_LABEL（MD 导出同一张表）。
// 这里原本有一份自己的 STATUS，词表与 MD 对不上，且漏了 SKIPPED/PENDING/ACTIVE，
// 于是 PPTX 标题直接印出裸枚举 SKIPPED —— 见 tests/kern-office-export.test.ts OX2。

// ───────── Markdown → 通用块（纯函数，便于测试） ─────────

export type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string; ordered: boolean }
  | { kind: "para"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

/** 去掉行内 Markdown 标记（加粗、代码、链接），保留文字。 */
export function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)\*([^\s][^]*)\\*/g, "$1$2")
    .trim();
}

export function markdownBlocks(md: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "para", text: plainInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cells = tableCells(line);
    if (cells && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flush();
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && tableCells(lines[i])) {
        rows.push(tableCells(lines[i])!.map(plainInline));
        i += 1;
      }
      i -= 1;
      out.push({ kind: "table", header: cells.map(plainInline), rows });
      continue;
    }
    if (/^```/.test(line.trim())) {
      flush();
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) i += 1;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ kind: "heading", level: h[1].length, text: plainInline(h[2]) });
      continue;
    }
    const b = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (b) {
      flush();
      out.push({ kind: "bullet", text: plainInline(b[3]), ordered: !!b[2] });
      continue;
    }
    if (/^\s*>/.test(line)) {
      para.push(line.replace(/^\s*>\s?/, ""));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

const outcomeText = (r: MissionReport) =>
  r.outcome === "COMPLETED" ? "已完成" : r.outcome === "CANCELLED" ? "已取消" : r.outcome ? "需要你处理" : "进行中";

/** 报告里所有表格（结论 + 各步骤），带来源标签。 */
export function reportTables(r: MissionReport): { source: string; header: string[]; rows: string[][] }[] {
  const out: { source: string; header: string[]; rows: string[][] }[] = [];
  const add = (source: string, md: string | null) => {
    for (const b of markdownBlocks(md ?? "")) if (b.kind === "table") out.push({ source, header: b.header, rows: b.rows });
  };
  add("结论", r.conclusion);
  for (const s of r.steps) add(s.label, s.output);
  return out;
}

// ───────── DOCX ─────────

async function buildDocx(r: MissionReport): Promise<Buffer> {
  // 动态导入 - 按需加载
  const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = await import("docx");

  function docxBlocks(blocks: MdBlock[], baseLevel: number): (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] {
    const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
    return blocks.map((b) => {
      if (b.kind === "heading") return new Paragraph({ text: b.text, heading: levels[Math.min(5, baseLevel + b.level - 1)] });
      if (b.kind === "bullet") return new Paragraph({ children: [new TextRun({ text: b.text, font: FONT })], bullet: { level: 0 } });
      if (b.kind === "para") return new Paragraph({ children: [new TextRun({ text: b.text, font: FONT })], spacing: { after: 120 } });
      const row = (cells: string[], bold = false) =>
        new TableRow({
          children: b.header.map(
            (_h, k) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cells[k] ?? "", bold, font: FONT })] })] })
          ),
        });
      return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(b.header, true), ...b.rows.map((r) => row(r))] });
    });
  }

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ text: r.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: `Kern 任务报告 · ${r.createdAt.slice(0, 10)} · ${outcomeText(r)}`, color: "666666", font: FONT })],
    }),
  ];
  if (r.demo) children.push(new Paragraph({ children: [new TextRun({ text: "演示数据：以下为示例，不代表真实调研结论。", bold: true, color: "B45309", font: FONT })] }));
  if (r.constraints.length) {
    children.push(new Paragraph({ text: "已确认的约束", heading: HeadingLevel.HEADING_1 }));
    for (const c of r.constraints) children.push(new Paragraph({ children: [new TextRun({ text: `${c.question}：`, bold: true, font: FONT }), new TextRun({ text: c.answer, font: FONT })], bullet: { level: 0 } }));
  }
  if (r.decision) {
    children.push(new Paragraph({ text: "需要你决定", heading: HeadingLevel.HEADING_1 }), ...docxBlocks(markdownBlocks(r.decision), 2));
  }
  children.push(new Paragraph({ text: "结论", heading: HeadingLevel.HEADING_1 }));
  children.push(...(r.conclusion?.trim() ? docxBlocks(markdownBlocks(r.conclusion), 2) : [new Paragraph("（这次没有形成综合结论）")]));
  children.push(new Paragraph({ text: "各步骤产出", heading: HeadingLevel.HEADING_1 }));
  for (const s of r.steps) {
    children.push(new Paragraph({ text: `${s.label}（${s.agent} · ${STATUS_LABEL[s.status] ?? s.status}）`, heading: HeadingLevel.HEADING_2 }));
    children.push(...(s.output?.trim() ? docxBlocks(markdownBlocks(s.output), 3) : [new Paragraph("（暂无产出）")]));
  }
  children.push(new Paragraph({ text: "关于这次任务", heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: `消耗：${r.meta.tasksCreated} 个步骤任务（上限 ${r.meta.maxTasks}）`, bullet: { level: 0 } }));
  children.push(new Paragraph({ text: `用到的记忆：${r.meta.memoriesUsed.length ? r.meta.memoriesUsed.join("；") : "无"}`, bullet: { level: 0 } }));
  const doc = new Document({
    creator: "Kern",
    title: r.title,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

// ───────── XLSX ─────────

function sheetName(base: string, used: Set<string>): string {
  const clean = base.replace(/[\\/?*[\\]:]/g, " ").trim().slice(0, 28) || "表";
  let name = clean;
  for (let k = 2; used.has(name); k++) name = `${clean.slice(0, 26)}-${k}`;
  used.add(name);
  return name;
}

export function xlsxPlan(r: MissionReport) {
  const tables = reportTables(r);
  return {
    overview: [
      ["目标", r.title],
      ["状态", outcomeText(r)],
      ["日期", r.createdAt.slice(0, 10)],
      ["建议", r.recommendation ?? ""],
      ["需要你决定", r.decision ?? ""],
      ...(r.demo ? [["说明", "演示数据：以下为示例，不代表真实调研结论"]] : []),
      ...r.constraints.map((c) => [`约束 · ${c.question}`, c.answer]),
    ],
    steps: r.steps.map((s) => [s.label, s.agent, STATUS_LABEL[s.status] ?? s.status, plainInline((s.output ?? "").replace(/\s+/g, " ")).slice(0, 500)]),
    tables,
  };
}

async function buildXlsx(r: MissionReport): Promise<{ buffer: Buffer; expected: Record<string, number> }> {
  const ExcelJS = (await import("exceljs")).default;
  const plan = xlsxPlan(r);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kern";
  const used = new Set<string>();
  const expected: Record<string, number> = {};
  const ov = wb.addWorksheet(sheetName("概览", used));
  ov.columns = [{ header: "项目", key: "k", width: 22 }, { header: "内容", key: "v", width: 90 }];
  for (const [k, v] of plan.overview) ov.addRow({ k, v });
  expected[ov.name] = plan.overview.length + 1;
  const st = wb.addWorksheet(sheetName("步骤", used));
  st.columns = [
    { header: "步骤", key: "a", width: 18 },
    { header: "负责", key: "b", width: 16 },
    { header: "状态", key: "c", width: 10 },
    { header: "摘要", key: "d", width: 100 },
  ];
  for (const row of plan.steps) st.addRow(row);
  expected[st.name] = plan.steps.length + 1;
  plan.tables.forEach((t, k) => {
    const ws = wb.addWorksheet(sheetName(`${t.source}-表${k + 1}`, used));
    ws.addRow(t.header);
    for (const row of t.rows) ws.addRow(row.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 20));
    expected[ws.name] = t.rows.length + 1;
  });
  for (const ws of wb.worksheets) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, expected };
}

// ───────── PPTX ─────────

/** 从一段产出里挑最多 n 条要点：优先列表项，其次段落首句。 */
export function keyPoints(md: string | null, n = 6): string[] {
  const blocks = markdownBlocks(md ?? "");
  const bullets = blocks.filter((b) => b.kind === "bullet").map((b) => (b as { text: string }).text);
  const paras = blocks.filter((b) => b.kind === "para").map((b) => (b as { text: string }).text.split(/(?<=[。！？.!?])/)[0]);
  return [...bullets, ...paras].map((t) => (t.length > 80 ? t.slice(0, 79) + "…" : t)).filter(Boolean).slice(0, n);
}

export function pptxPlan(r: MissionReport): { title: string; bullets: string[] }[] {
  const slides: { title: string; bullets: string[] }[] = [];
  const lead = keyPoints(r.conclusion, 5);
  slides.push({ title: "结论", bullets: lead.length ? lead : ["这次没有形成综合结论"] });
  if (r.decision || r.recommendation) {
    slides.push({ title: "建议与待你决定", bullets: [r.recommendation, r.decision].filter((x): x is string => !!x).map(plainInline).slice(0, 4) });
  }
  for (const s of r.steps) {
    const pts = keyPoints(s.output);
    slides.push({ title: `${s.label} · ${STATUS_LABEL[s.status] ?? s.status}`, bullets: pts.length ? pts : ["（暂无产出）"] });
  }
  return slides;
}

async function buildPptx(r: MissionReport): Promise<{ buffer: Buffer; slides: number }> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Kern";
  pptx.title = r.title;
  const cover = pptx.addSlide();
  cover.addText(r.title, { x: 0.6, y: 2.2, w: 12, h: 1.2, fontSize: 32, bold: true, fontFace: FONT, color: "111827" });
  cover.addText(`Kern 任务报告 · ${r.createdAt.slice(0, 10)} · ${outcomeText(r)}${r.demo ? " · 演示数据" : ""}`, {
    x: 0.6, y: 3.5, w: 12, h: 0.5, fontSize: 14, fontFace: FONT, color: "6B7280",
  });
  const plan = pptxPlan(r);
  for (const s of plan) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 24, bold: true, fontFace: FONT, color: "111827" });
    slide.addText(
      s.bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
      { x: 0.8, y: 1.4, w: 11.6, h: 5.4, fontSize: 16, fontFace: FONT, color: "1F2937", valign: "top", paraSpaceAfter: 8 }
    );
    if (r.demo) slide.addText("演示数据", { x: 11.2, y: 7.0, w: 1.8, h: 0.3, fontSize: 10, color: "B45309", fontFace: FONT, align: "right" });
  }
  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return { buffer: Buffer.from(out), slides: plan.length + 1 };
}

// ───────── 回读校验 ─────────

export type OfficeCheck = { format: OfficeFormat; sha256: string; bytes: number; detail: Record<string, number> };

export async function verifyOffice(format: OfficeFormat, buffer: Buffer): Promise<Record<string, number>> {
  if (format === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return Object.fromEntries(wb.worksheets.map((ws) => [ws.name, ws.actualRowCount]));
  }
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  if (format === "pptx") {
    return { slides: Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length };
  }
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  return { paragraphs: (xml.match(/<w:p[ >]/g) ?? []).length, tables: (xml.match(/<w:tbl>/g) ?? []).length };
}

export async function buildOfficeReport(r: MissionReport, format: OfficeFormat): Promise<{ buffer: Buffer; check: OfficeCheck }> {
  let buffer: Buffer;
  let detail: Record<string, number>;
  if (format === "xlsx") {
    const x = await buildXlsx(r);
    buffer = x.buffer;
    detail = await verifyOffice("xlsx", buffer);
    for (const [name, rows] of Object.entries(x.expected)) {
      if (detail[name] !== rows) throw new Error(`XLSX 回读不一致：${name} 期望 ${rows} 行，实际 ${detail[name] ?? 0}`);
    }
  } else if (format === "pptx") {
    const p = await buildPptx(r);
    buffer = p.buffer;
    detail = await verifyOffice("pptx", buffer);
    if (detail.slides !== p.slides) throw new Error(`PPTX 回读不一致：期望 ${p.slides} 页，实际 ${detail.slides}`);
  } else {
    buffer = await buildDocx(r);
    detail = await verifyOffice("docx", buffer);
    const expectedTables = reportTables(r).length;
    if (detail.paragraphs < 3 || detail.tables < expectedTables) {
      throw new Error(`DOCX 回读不一致：段落 ${detail.paragraphs}，表格 ${detail.tables}/${expectedTables}`);
    }
  }
  return { buffer, check: { format, sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length, detail } };
}
