/**
 * PDF 正文抽取。
 *
 * 一个绕不开的事实：PDF 分「文字型」和「扫描型」两种，后者在结构上就是一张张图。
 * unpdf 对后者只能抽出空串——这**不等于文件坏了**，只是它没字可读。所以这里在
 * 抽完之后统计有效字符密度，密度低到一定程度就明确标记为「疑似扫描件」，
 * 而不是让调用方拿到空字符串后自己猜是「读失败」还是「没内容」。
 */
import { extractText, getDocumentProxy } from "unpdf";
import type { FileParseOutcome, FileParser, ParserInput } from "../types";
import { MAX_EXTRACTED_CHARS } from "../limits";

/** 低于这个「每页平均有效字符数」就判定为疑似扫描件。 */
const SCAN_CHAR_DENSITY = 12;

const pdfParser: FileParser = {
  id: "pdf",
  label: "PDF 文档",
  extensions: [".pdf"],
  mimeHints: ["application/pdf"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    let pages: string[] = [];
    let totalPages = 0;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(input.buffer));
      const result = await extractText(pdf, { mergePages: false });
      totalPages = result.totalPages ?? 0;
      if (Array.isArray(result.text)) pages = result.text.map((p) => String(p ?? "").trim());
      else pages = [String(result.text ?? "").trim()];
    } catch (error) {
      return {
        status: "FAILED",
        kind: "pdf",
        text: "",
        meta: {},
        note: `PDF 解析失败：${error instanceof Error ? error.message.slice(0, 160) : String(error)}。文件可能损坏、加密，或采用了不支持的编码。`,
      };
    }

    const meaningful = pages.filter((p) => p.replace(/\s/g, "").length > 0);
    const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
    const density = totalPages > 0 ? totalChars / totalPages : 0;

    const notes: string[] = [];
    if (!totalPages) {
      notes.push("未能读出页数，文件可能损坏或为空。");
    } else if (totalPages > 0 && density < SCAN_CHAR_DENSITY) {
      notes.push(
        `共 ${totalPages} 页但只抽到 ${totalChars} 个字符，疑似**扫描版 PDF**（页面是图片，没有文字层）。` +
          "当前未接入图像识别，因此本轮无法阅读其页面内容——需要 OCR 才能拿到。"
      );
    }

    // 分页标注页码：让模型能回答「第几页讲了什么」，也让引用有锚点
    const body = pages
      .map((p, i) => (p ? `## 第 ${i + 1} 页\n${p}` : `## 第 ${i + 1} 页\n（本页无文字）`))
      .join("\n\n");

    let text = body;
    let truncated = false;
    if (text.length > MAX_EXTRACTED_CHARS) {
      text = text.slice(0, MAX_EXTRACTED_CHARS);
      truncated = true;
      notes.push(`正文超出 ${MAX_EXTRACTED_CHARS} 字上限已截断，超出部分本轮不可见。`);
    }

    return {
      status: "READY",
      kind: "pdf",
      text,
      meta: { pageCount: totalPages, ...(meaningful.length ? { rowCount: meaningful.length } : {}) },
      note: notes.length ? notes.join(" ") : undefined,
      truncated,
    };
  },
};

export { pdfParser };
