/**
 * KX-32 往返（C6）：办公文件导入解析 —— DOCX / XLSX → 结构化数据。
 * ==================================================================
 *
 * - 与 office-export.ts（单向导出）配对：导出把 MissionReport 写成文件，
 *   本模块把用户已有的文件读回来，解析成可分析的结构。
 * - 只做「抽结构」：xlsx 抽 sheet / 表头 / 数据行，docx 抽标题 / 段落 / 表格；
 *   不做样式还原、不做公式求值（公式单元格读成 "=SUM(...)" 文本，标记其存在）。
 * - 重型库动态导入，与 office-export 的按需加载口径一致（不进客户端包）。
 */

export type ImportedCell = string | number | boolean | null;

export type ImportedSheet = {
  name: string;
  /** 第一行（表头）。 */
  header: ImportedCell[];
  /** 表头之后的数据行（全空行跳过）。 */
  rows: ImportedCell[][];
};

export type ImportedWorkbook = { sheets: ImportedSheet[] };

export type ImportedDocBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

export type ImportedDocument = { blocks: ImportedDocBlock[] };

export type OfficeImportFormat = "docx" | "xlsx";

/** 依据文件名判格式；只认 docx / xlsx，其余返回 null（pptx 往返未做，见 office-roundtrip）。 */
export function officeImportFormat(fileName: string): OfficeImportFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

// ───────── XLSX ─────────

/** exceljs 的单元格值形态很多：公式 / 富文本 / 超链接 / 日期，统一收敛成标量。 */
function cellScalar(value: unknown): ImportedCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // 公式单元格：保留 "=公式" 文本，让下游知道这里是算出来的，不是原始数。
    if (typeof o.formula === "string") return `=${o.formula}`;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: unknown }[]).map((r) => (typeof r.text === "string" ? r.text : "")).join("");
    }
    if (o.result !== undefined) return cellScalar(o.result);
    if (typeof o.text === "string") return o.text;
    if (typeof o.hyperlink === "string") return o.hyperlink;
  }
  return String(value);
}

export async function parseXlsx(buffer: Buffer): Promise<ImportedWorkbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: ImportedSheet[] = wb.worksheets.map((ws) => {
    const all: ImportedCell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map(cellScalar);
      // 尾部空单元格裁掉，行内空位保留 null（列对齐不能丢）。
      while (values.length && values[values.length - 1] === null) values.pop();
      all.push(values);
    });
    const [header = [], ...rows] = all;
    return { name: ws.name, header, rows };
  });
  return { sheets };
}

// ───────── DOCX ─────────

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 一段 w:p 的纯文本：拼全部 w:t。 */
function paragraphText(pXml: string): string {
  const parts = [...pXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => xmlUnescape(m[1]));
  return parts.join("").trim();
}

/** 标题级别：w:pStyle 的 Heading1..6 / Title；普通段落返回 0。 */
function headingLevel(pXml: string): number {
  const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(pXml)?.[1] ?? "";
  if (/^Title$/i.test(style)) return 1;
  const h = /^Heading([1-6])$/i.exec(style) ?? /^标题\s*([1-6])$/.exec(style);
  return h ? Number(h[1]) : 0;
}

/** 一张 w:tbl → 表格块：第一行作表头。单元格文本取其全部段落拼接。 */
function tableBlock(tblXml: string): ImportedDocBlock {
  const rows: string[][] = [];
  for (const tr of tblXml.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)) {
    const cells: string[] = [];
    for (const tc of tr[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)) {
      const paras = [...tc[1].matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((p) => paragraphText(p[1]));
      cells.push(paras.filter(Boolean).join(" "));
    }
    rows.push(cells);
  }
  const [header = [], ...body] = rows;
  return { kind: "table", header, rows: body };
}

export async function parseDocx(buffer: Buffer): Promise<ImportedDocument> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  // 顺序扫描：表格整段先匹配（其内段落不再单独成块），段落次之，保持原文顺序。
  const tokens = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  const blocks: ImportedDocBlock[] = [];
  for (const token of tokens) {
    if (token.startsWith("<w:tbl>")) {
      blocks.push(tableBlock(token));
      continue;
    }
    const text = paragraphText(token);
    if (!text) continue;
    const level = headingLevel(token);
    blocks.push(level > 0 ? { kind: "heading", level, text } : { kind: "para", text });
  }
  return { blocks };
}

/** 按格式分发解析。 */
export async function parseOffice(buffer: Buffer, format: OfficeImportFormat): Promise<ImportedWorkbook | ImportedDocument> {
  return format === "xlsx" ? parseXlsx(buffer) : parseDocx(buffer);
}
