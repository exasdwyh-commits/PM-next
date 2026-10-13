/**
 * 文件读取的边界常量。
 *
 * 三条上限各自有独立理由，不要合并成一个「总开关」：
 *  - 字节上限防的是**落盘与解码**，发生在读到内容之前；
 *  - 字数上限防的是**上下文被撑爆**，发生在读到内容之后；
 *  - 份数上限防的是**一轮消息挂太多文件**导致自带的正文互相挤掉。
 */
import type { ParsedFileKind } from "./types";

/** 单文件落盘上限。PDF 与办公文档压缩率很高，25MB 已能覆盖绝大多数交付稿。 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * 单文件提取正文的字符上限。约合 2～3 万 token；再往上，一份文件就会
 * 挤掉它旁边的其他文件与会话历史，反而降低回答质量。
 */
export const MAX_EXTRACTED_CHARS = 80_000;

/** 一轮消息最多带几份文件。多于此数让用户分批，而不是静默丢掉后面的。 */
export const MAX_FILES_PER_MESSAGE = 8;

/** 供上游显示 label 的稳定顺序。 */
export const SUPPORTED_LABELS: { kind: ParsedFileKind; label: string; extensions: string[] }[] = [
  { kind: "pdf", label: "PDF", extensions: [".pdf"] },
  { kind: "docx", label: "Word", extensions: [".docx"] },
  { kind: "pptx", label: "PowerPoint", extensions: [".pptx"] },
  { kind: "xlsx", label: "Excel", extensions: [".xlsx", ".xlsm"] },
  { kind: "html", label: "网页", extensions: [".html", ".htm"] },
  { kind: "markdown", label: "Markdown", extensions: [".md", ".markdown"] },
  { kind: "csv", label: "CSV", extensions: [".csv", ".tsv"] },
  { kind: "json", label: "JSON", extensions: [".json"] },
  { kind: "text", label: "纯文本", extensions: [".txt", ".log", ".yaml", ".yml"] },
  { kind: "image", label: "图片", extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"] },
  { kind: "video", label: "视频", extensions: [".mp4", ".mov", ".m4v", ".webm"] },
];
