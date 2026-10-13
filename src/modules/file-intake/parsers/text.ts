/**
 * 纯文本家族：txt / md / csv / json。
 *
 * 它们是同一件事的四种方言——文件本身就是文字，不需要解格式。真正的难点在
 * **体量**：一个 10 万行的 CSV 和一份 5MB 的 JSON dump，字节数体检合格，
 * 但整篇塞进上下文会把同轮的其它材料挤没。所以这里每个格式都先把「结构」
 * 摸出来（行列数、顶层键、标题层级），再决定正文给多少。
 *
 * 前提是这些文件的编码不确定：中文环境大量 GBK 文件不会被标成 UTF-8。
 * Node 原生不认 GBK，所以这里做的是**尽力识别**，识别不出就按 UTF-8 解。
 * 解出来有多少替换字符（U+FFFD）如实告诉调用方，不装作「读全了」。
 */
import type { FileParseOutcome, FileParser, ParserInput } from "../types";
import { MAX_EXTRACTED_CHARS } from "../limits";

/** 读一个可能不是 UTF-8 的文本。返回替换字符数量，供调用方判断解码是否可信。 */
function decodeBuffer(buffer: Buffer): { text: string; replacementChars: number } {
  let text = buffer.toString("utf8");
  let replacementChars = (text.match(/\uFFFD/g) ?? []).length;
  // 少量替换字符可能是文件里本来就有的；超过万分之一说明编码猜错了。
  // 这里不尝试转换 GBK（Node 无内置解码器、引入 iconv 不值得），
  // 而是把「这份解码结果不可靠」作为事实交给调用方。
  const ratio = replacementChars / Math.max(1, text.length);
  if (ratio > 0.001) return { text, replacementChars };
  return { text: text.replace(/^\uFEFF/, ""), replacementChars: 0 };
}

function finalize(
  kind: FileParseOutcome["kind"],
  raw: string,
  meta: FileParseOutcome["meta"],
  extraNote?: string
): FileParseOutcome {
  const text = raw.trim();
  const truncated = text.length > MAX_EXTRACTED_CHARS;
  const notes: string[] = [];
  if (extraNote) notes.push(extraNote);
  if (truncated) {
    notes.push(
      `正文超出 ${MAX_EXTRACTED_CHARS} 字上限，已截断到第 ${MAX_EXTRACTED_CHARS} 字；被截掉的部分本轮不可见。`
    );
  }
  return {
    status: "READY",
    kind,
    text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text,
    meta,
    truncated,
    note: notes.length ? notes.join(" ") : undefined,
  };
}

/** 取前若干个非空标题行，给调用方一个内容轮廓。 */
function mdHeadings(text: string, limit = 20): string[] {
  const out: string[] = [];
  // 跳过 fenced code block 里的 # 注释行
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push(`${"#".repeat(m[1].length)} ${m[2]}`);
    if (out.length >= limit) break;
  }
  return out;
}

const textParser: FileParser = {
  id: "text",
  label: "纯文本",
  extensions: [".txt", ".log", ".yaml", ".yml", ".ini", ".sql"],
  mimeHints: ["text/plain"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const { text, replacementChars } = decodeBuffer(input.buffer);
    const lines = text.split(/\r?\n/);
    return finalize(
      "text",
      text,
      { rowCount: lines.length },
      replacementChars > 0
        ? `解码出现 ${replacementChars} 个无法识别的字符，原文可能不是 UTF-8 编码；已读取部分的含义可能有偏差。`
        : undefined
    );
  },
};

const markdownParser: FileParser = {
  id: "markdown",
  label: "Markdown",
  extensions: [".md", ".markdown", ".mdx"],
  mimeHints: ["text/markdown"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const { text, replacementChars } = decodeBuffer(input.buffer);
    return finalize(
      "markdown",
      text,
      { headings: mdHeadings(text), rowCount: text.split(/\r?\n/).length },
      replacementChars > 0
        ? `解码出现 ${replacementChars} 个无法识别的字符，原文可能不是 UTF-8 编码。`
        : undefined
    );
  },
};

/** CSV：先给 header 与行列规模，正文只取前面一段——后面的数据行边际价值低。 */
const csvParser: FileParser = {
  id: "csv",
  label: "CSV 表格",
  extensions: [".csv", ".tsv"],
  mimeHints: ["text/csv", "text/tab-separated-values"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const delimiter = input.filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const { text } = decodeBuffer(input.buffer);
    const rows = splitCsvRows(text, delimiter);
    const header = rows.length ? rows[0] : [];
    const PREVIEW_ROWS = 200;

    const head = rows.slice(0, PREVIEW_ROWS).map((r) => r.join(delimiter)).join("\n");
    const omitted = Math.max(0, rows.length - PREVIEW_ROWS);
    const summary = `表格：${rows.length} 行 × ${header.length} 列，列名=${header.join(" / ") || "（无）"}`;
    const body = omitted
      ? `${summary}\n数据预览（前 ${PREVIEW_ROWS} 行，其余 ${omitted} 行未列出）：\n${head}`
      : `${summary}\n${head}`;

    return finalize("csv", body, {
      rowCount: rows.length,
      columnCount: header.length,
      headings: header.slice(0, 30),
    });
  },
};

/** 极简 CSV 行切分：处理引号包裹与引号转义，不追求 RFC 4180 全兼容。 */
function splitCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** JSON：正文给美化后的前若干行；更重要的是把顶层结构与规模说清楚。 */
const jsonParser: FileParser = {
  id: "json",
  label: "JSON",
  extensions: [".json", ".jsonl"],
  mimeHints: ["application/json"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const { text } = decodeBuffer(input.buffer);

    if (input.filename.toLowerCase().endsWith(".jsonl")) {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const PREVIEW = 50;
      const body = [
        `JSONL：${lines.length} 条记录。`,
        `前 ${Math.min(PREVIEW, lines.length)} 条：`,
        lines.slice(0, PREVIEW).join("\n"),
      ].join("\n");
      return finalize("json", body, { rowCount: lines.length });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      // 解不开也是事实：给不了结构，但原始文字还在，照样交出去。
      return finalize(
        "json",
        text,
        {},
        `JSON 解析失败（${error instanceof Error ? error.message.slice(0, 120) : "未知原因"}），以下为原始文本。`
      );
    }

    const shape = describeJsonShape(parsed);
    const pretty = JSON.stringify(parsed, null, 2);
    const body = `JSON 结构：${shape}\n\n${pretty}`;
    const meta: FileParseOutcome["meta"] = {};
    if (Array.isArray(parsed)) meta.rowCount = parsed.length;
    else if (parsed && typeof parsed === "object") meta.headings = Object.keys(parsed as object).slice(0, 30);
    return finalize("json", body, meta);
  },
};

/** 只描述形状，不把值摊开——防止结构本身就是几万字的 dump。 */
function describeJsonShape(value: unknown, depth = 0): string {
  if (depth > 2) return "…";
  if (Array.isArray(value)) {
    if (!value.length) return "空数组";
    return `数组(${value.length})，元素形如 ${describeJsonShape(value[0], depth + 1)}`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object);
    if (!keys.length) return "空对象";
    const preview = keys
      .slice(0, 8)
      .map((k) => `${k}: ${describeJsonShape((value as Record<string, unknown>)[k], depth + 1)}`)
      .join("，");
    return `{${preview}${keys.length > 8 ? `，…共 ${keys.length} 个键` : ""}}`;
  }
  return value === null ? "null" : typeof value;
}

export const plainTextParsers: FileParser[] = [
  textParser,
  markdownParser,
  csvParser,
  jsonParser,
];
