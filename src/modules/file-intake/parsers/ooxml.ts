/**
 * OOXML 三件套：Word(.docx) / PowerPoint(.pptx) / Excel(.xlsx)。
 *
 * 选 jszip + 手写 XML 抽取，而不是各引一个专用库（mammoth / xlsx-populate 等）：
 *  - 三种格式共用同一层「zip + 抽 local name」的工具，代码量比引三个库更小；
 *  - 我们要的是**带上结构的文字**（页 / 层级 / 行列），不是渲染还原，
 *    专用库多半已经把结构拍平或反过来塞进它们自己的对象模型；
 *  - 少一个 Native/大依赖，就少一处构建期与运行期的不可控。
 *
 * 一条硬边界：**只读 zip 内的条目，不解压到磁盘**。附件是不可信输入，
 * zip-slip 与超大解压比这类场景里任何解析失败都危险，所以全程在内存里处理。
 */
import JSZip from "jszip";
import type { FileParseOutcome, FileParser, FileParserMeta, ParserInput } from "../types";
import { MAX_EXTRACTED_CHARS } from "../limits";

type Zip = InstanceType<typeof JSZip>;

async function openZip(input: ParserInput): Promise<Zip> {
  return JSZip.loadAsync(input.buffer, { checkCRC32: false });
}

function readString(zip: Zip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async("string") : Promise.resolve(null);
}

/** 按数字给 zip 内同前缀条目排序：`slide10` 必须排在 `slide2` 之后，字典序会错。 */
function naturalSort<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const ma = ka.match(/(\d+)/g);
    const mb = kb.match(/(\d+)/g);
    if (!ma || !mb) return ka.localeCompare(kb);
    for (let i = 0; i < Math.max(ma.length, mb.length); i += 1) {
      const na = Number(ma[i] ?? 0);
      const nb = Number(mb[i] ?? 0);
      if (na !== nb) return na - nb;
    }
    return ka.localeCompare(kb);
  });
}

/** 取某标签的全部文本内容（忽略命名空间前缀），并把 `>`/`<` 还原成字符。 */
function textOfTag(xml: string, localName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:\\w+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${localName}\\s*>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeXmlText(m[1]));
  return out;
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(?:[\w-]+:)?(?:tab|br)\b[^>]*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function truncateText(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}

function finish(
  kind: FileParseOutcome["kind"],
  raw: string,
  meta: FileParserMeta,
  notes: string[]
): FileParseOutcome {
  const { text, truncated } = truncateText(raw);
  if (truncated) {
    notes.push(`正文超出 ${MAX_EXTRACTED_CHARS} 字上限已截断，超出部分本轮不可见。`);
  }
  return {
    status: "READY",
    kind,
    text,
    meta,
    note: notes.length ? notes.join(" ") : undefined,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

/** `w:styles.xml` 里 styleId → 样式名，用来把 `Heading2` 认成二级标题。 */
function readHeadingStyles(stylesXml: string | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!stylesXml) return map;
  const re = /<(?:[\w-]+:)?style\b[^>]*\bw:styleId="([^"]+)"[\s\S]*?<\/(?:[\w-]+:)?style\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stylesXml))) {
    const nameMatch = m[0].match(/<(?:[\w-]+:)?w:name\s+w:val="([^"]+)"/i)
      ?? m[0].match(/<(?:[\w-]+:)?name\s+val="([^"]+)"/i);
    if (!nameMatch) continue;
    const heading = /^heading\s*([1-9])$/i.exec(nameMatch[1].trim());
    if (heading) map.set(m[1], Number(heading[1]));
    // 中文模板常把标题样式命名为「标题 2」
    const cn = /^标题\s*([1-9])$/.exec(nameMatch[1].trim());
    if (cn) map.set(m[1], Number(cn[1]));
  }
  return map;
}

function extractDocxBody(documentXml: string, headingStyles: Map<string, number>): {
  text: string;
  headings: string[];
  paragraphCount: number;
} {
  const lines: string[] = [];
  const headings: string[] = [];
  let paragraphCount = 0;

  // 按 **body 的直接子块**扫描，而不是只按 `w:p`：
  // `<w:tbl>` 与 `<w:p>` 是同级的（表格不属于任何段落），只按 `w:p` 遍历会让
  // 表格根本进不到表格分支，单元格里的段落反而被当成正文，行列结构全散。
  // 这里靠反向引用保证 `<w:tbl>…</w:tbl>` 被整体消耗掉，其内的 `w:p` 不再单独出现。
  const blockRe = /<(?:[\w-]+:)?(p|tbl)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>/g;
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(documentXml))) {
    const raw = m[0];
    const inner = m[2];

    // ---- 表格：整块按行/列重组成 `A | B` ----
    if (m[1] === "tbl") {
      const rows = raw.match(/<(?:[\w-]+:)?w:tr\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?w:tr\s*>/g) ?? [];
      for (const row of rows) {
        const cells = row.match(/<(?:[\w-]+:)?w:tc\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?w:tc\s*>/g) ?? [];
        const values = cells.map((c) => textOfTag(c, "t").join(" ").trim());
        if (values.some((v) => v)) lines.push(values.join(" | "));
      }
      paragraphCount += rows.length;
      continue;
    }

    const styleId = /w:pStyle\s+w:val="([^"]+)"/i.exec(raw)?.[1]
      ?? /pStyle\s+val="([^"]+)"/i.exec(raw)?.[1];

    const words = textOfTag(inner, "t").join("").trim();
    if (!words) continue;
    paragraphCount += 1;

    // 标题样式（含中文「标题 N」命名）转成 Markdown 层级，让正文保留大纲结构
    const level = styleId ? headingStyles.get(styleId) : undefined;
    if (level) {
      headings.push(`${"#".repeat(level)} ${words}`);
      lines.push(`${"#".repeat(level)} ${words}`);
    } else {
      lines.push(words);
    }
  }

  return { text: lines.join("\n"), headings: headings.slice(0, 40), paragraphCount };
}

const docxParser: FileParser = {
  id: "docx",
  label: "Word 文档",
  extensions: [".docx"],
  mimeHints: ["officedocument.wordprocessingml"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const zip = await openZip(input);
    const documentXml = await readString(zip, "word/document.xml");
    if (!documentXml) {
      return {
        status: "FAILED",
        kind: "docx",
        text: "",
        meta: {},
        note: "文件是 docx 扩展名，但 zip 里没有 word/document.xml；可能是改了后缀名的其它格式。",
      };
    }
    const notes: string[] = [];
    const stylesXml = await readString(zip, "word/styles.xml");
    const { text, headings, paragraphCount } = extractDocxBody(documentXml, readHeadingStyles(stylesXml));

    const coreXml = await readString(zip, "docProps/core.xml");
    const title = coreXml ? (textOfTag(coreXml, "dc:title")[0] ?? undefined) : undefined;
    const author = coreXml ? (textOfTag(coreXml, "dc:creator")[0] ?? undefined) : undefined;

    const header = [
      title ? `# ${title}` : null,
      author ? `作者：${author}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return finish("docx", header ? `${header}\n\n${text}` : text, {
      ...(title ? { headings: [title] } : {}),
      rowCount: paragraphCount,
      ...(headings.length ? { headings } : {}),
    }, notes);
  },
};

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

/** 幻灯片里的 `<a:t>` 文本按 `<a:p>` 段落重组；备注单独取，因为它们常常才是真内容。 */
function extractSlideTexts(slideXml: string): string[] {
  const out: string[] = [];
  const paraRe = /<(?:[\w-]+:)?a:p\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?a:p\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(slideXml))) {
    const words = textOfTag(m[1], "a:t").join("").trim();
    if (words) out.push(words);
  }
  if (!out.length) {
    // 有些幻灯片把文字放在没有 `<a:p>` 的形状里（如艺术字），整页取一次作为兜底
    const loose = textOfTag(slideXml, "a:t").map((s) => s.trim()).filter(Boolean);
    out.push(...loose);
  }
  return out;
}

const pptxParser: FileParser = {
  id: "pptx",
  label: "PowerPoint 演示",
  extensions: [".pptx"],
  mimeHints: ["officedocument.presentationml"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const zip = await openZip(input);
    const entries = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    if (!entries.length) {
      return {
        status: "FAILED",
        kind: "pptx",
        text: "",
        meta: {},
        note: "文件是 pptx 扩展名，但 zip 里没有 ppt/slides/slideN.xml。",
      };
    }
    const slides = naturalSort(entries, (p) => p);
    const blocks: string[] = [];
    let noteCount = 0;

    for (let i = 0; i < slides.length; i += 1) {
      const path = slides[i];
      const xml = await readString(zip, path);
      if (!xml) continue;
      const lines = extractSlideTexts(xml);
      blocks.push(`## 第 ${i + 1} 页\n${lines.join("\n") || "（本页无可提取文字，可能是纯图片页）"}`);

      // 备注页与幻灯片按数字对应：notesSlide1.xml 对应 slide1.xml
      const notePath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
      const noteXml = await readString(zip, notePath);
      if (noteXml) {
        const note = textOfTag(noteXml, "a:t").map((s) => s.trim()).filter(Boolean);
        if (note.length) {
          noteCount += 1;
          blocks.push(`> 演讲者备注：${note.join("\n> ")}`);
        }
      }
    }

    const meta: FileParserMeta = { slideCount: slides.length };
    if (noteCount) meta.rowCount = noteCount;
    return finish("pptx", blocks.join("\n\n"), meta, [
      "按页整理：幻灯片页 Header 为二级标题，演讲者备注以引用块标注。",
    ]);
  },
};

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/** `xl/sharedStrings.xml`：共享字符串池，数字单元格直接引用下标。 */
function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<(?:[\w-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?si\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    // 富文本 `<r><t>…</t></r>` 与普通 `<t>…</t>` 都要覆盖
    const parts = textOfTag(m[1], "t").filter((s) => s !== "");
    out.push(parts.join(""));
  }
  return out;
}

type SheetRef = { name: string; path: string };

/** workbook.xml + workbook.xml.rels：拿到 sheet 名与实际 xml 路径的对应。 */
function readSheetRefs(zip: Zip, workbookXml: string | null, relsXml: string | null): SheetRef[] {
  if (!workbookXml) return [];
  const idToTarget = new Map<string, string>();
  if (relsXml) {
    const re = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(relsXml))) {
      let target = m[2];
      if (!target.startsWith("/")) target = `xl/${target.replace(/^\.?\//, "")}`;
      else target = target.replace(/^\//, "");
      idToTarget.set(m[1], target);
    }
  }

  const out: SheetRef[] = [];
  const re = /<(?:[\w-]+:)?sheet\b[^>]*\bname="([^"]*)"[^>]*?(?:r:id|id)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workbookXml))) {
    const target = idToTarget.get(m[2]);
    if (target) out.push({ name: m[1], path: target });
  }
  return out;
}

/** 列字母转下标：`B` → 1，`AA` → 26。用于补齐空单元格。 */
function columnIndex(cellRef: string): number {
  const letters = cellRef.replace(/\d+/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

const MAX_ROWS_PER_SHEET = 500;

function parseSheet(xml: string, shared: string[]): { rows: string[][]; totalRows: number } {
  const rows: string[][] = [];
  const rowRe = /<(?:[\w-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?row\s*>/g;
  let totalRows = 0;
  let m: RegExpExecArray | null;
  let emptyTail = 0;

  while ((m = rowRe.exec(xml))) {
    totalRows += 1;
    if (rows.length >= MAX_ROWS_PER_SHEET) continue;
    const cells: string[] = [];
    const cellRe = /<(?:[\w-]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?c\s*>|<\/?(?:[\w-]+:)?c\b([^>]*)\/?>/g;
    let cell: RegExpExecArray | null;
    const raw = m[1];
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(raw))) {
      const attrs = cell[1] ?? cell[3] ?? "";
      const inner = cell[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/i.exec(attrs)?.[1] ?? "";
      const idx = ref ? columnIndex(ref) : cells.length;
      let value = "";
      if (type === "inlineStr") {
        value = textOfTag(inner, "t").join("");
      } else if (type === "s") {
        const sharedIdx = Number(textOfTag(inner, "v")[0] ?? NaN);
        value = Number.isFinite(sharedIdx) ? (shared[sharedIdx] ?? "") : "";
      } else {
        value = textOfTag(inner, "v")[0] ?? textOfTag(inner, "t").join("");
      }
      value = value.trim();
      while (cells.length < idx) cells.push("");
      cells[idx] = value;
    }
    if (cells.some((c) => c)) {
      rows.push(cells);
      emptyTail = 0;
    } else {
      // 连续空行只记一次，避免尾部几千个空 row 元素刷行数
      emptyTail += 1;
      if (emptyTail === 1) rows.push([]);
    }
  }
  return { rows, totalRows };
}

const xlsxParser: FileParser = {
  id: "xlsx",
  label: "Excel 工作簿",
  extensions: [".xlsx", ".xlsm"],
  mimeHints: ["officedocument.spreadsheetml"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const zip = await openZip(input);
    const workbookXml = await readString(zip, "xl/workbook.xml");
    const relsXml = await readString(zip, "xl/_rels/workbook.xml.rels");
    const shared = readSharedStrings(await readString(zip, "xl/sharedStrings.xml"));

    let refs = readSheetRefs(zip, workbookXml, relsXml);
    if (!refs.length) {
      // 兜底：不看 rels，直接按 worksheet 文件名序保底处理，宁可错不要丢
      refs = Object.keys(zip.files)
        .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
        .map((p, i) => ({ name: `Sheet${i + 1}`, path: p }));
    }
    if (!refs.length) {
      return {
        status: "FAILED",
        kind: "xlsx",
        text: "",
        meta: {},
        note: "没有定位到任何工作表，文件可能损坏或不是有效工作簿。",
      };
    }

    const blocks: string[] = [];
    const sheetNames: string[] = [];
    let totalRows = 0;
    let truncatedSheets = 0;

    for (const ref of refs) {
      const xml = await readString(zip, ref.path);
      if (!xml) continue;
      const { rows, totalRows: count } = parseSheet(xml, shared);
      totalRows += count;
      sheetNames.push(ref.name);
      if (count > rows.length) truncatedSheets += 1;
      const body = rows.map((r) => r.join(" | ")).filter((line) => line.trim() !== "");
      blocks.push(
        `## 工作表：${ref.name}（${count} 行）\n${body.join("\n") || "（空表）"}`
      );
    }

    const notes: string[] = ["多个工作表按序分开列出，单元格以 `|` 分隔，行列结构保留。"];
    if (truncatedSheets) notes.push(`${truncatedSheets} 个工作表超过 ${MAX_ROWS_PER_SHEET} 行预览上限。`);
    return finish("xlsx", blocks.join("\n\n"), {
      sheetNames,
      rowCount: totalRows,
    }, notes);
  },
};

export const ooxmlParsers: FileParser[] = [docxParser, pptxParser, xlsxParser];
export { openZip, readString, naturalSort, textOfTag, truncateText };
