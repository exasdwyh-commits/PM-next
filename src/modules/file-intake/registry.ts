/**
 * 解析器注册表：格式 → 解析器的唯一分派点。
 *
 * 做成注册表而不是 if/else 链，是为了让「加一种格式」只等于「加一个文件里的一个对象」：
 * 新增格式时改的是这一处数组，调用方、上层 API、全部不用动。
 *
 * 匹配顺序有意为之：**先看扩展名，再看 mime**。
 * 浏览器给的 mime 并不可靠（常见的 `.csv` 被标成 `application/vnd.ms-excel`、
 * 很多系统给未知类型兜底 `application/octet-stream`），但反过来，
 * 故意改后缀名伪装成别的东西时，扩展名同样会骗人——所以解析失败必须允许
 * 调用方看到「扩展名说它是 X，但它的内容不是」。我们的解析器已经在各自的
 * FAILED 分支里写了这类判断。
 */
import type { FileParser } from "./types";
import { plainTextParsers } from "./parsers/text";
import { htmlParser } from "./parsers/html";
import { pdfParser } from "./parsers/pdf";
import { ooxmlParsers } from "./parsers/ooxml";
import { mediaParsers } from "./parsers/media";

/** 注册表全清单。顺序只影响「同名扩展」时的优先级，正常情况下彼此不重叠。 */
export const FILE_PARSERS: FileParser[] = [
  pdfParser,
  ...ooxmlParsers,
  htmlParser,
  ...plainTextParsers,
  ...mediaParsers,
];

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/** 按扩展名精确查表。 */
export function parserForExtension(filename: string): FileParser | null {
  const ext = extensionOf(filename);
  if (!ext) return null;
  return FILE_PARSERS.find((p) => p.extensions.includes(ext)) ?? null;
}

/** 扩展名查不到时的兜底：按 mime 片段试一次。 */
export function parserForMime(mimeType: string): FileParser | null {
  const mime = mimeType.toLowerCase();
  if (!mime) return null;
  return FILE_PARSERS.find((p) => (p.mimeHints ?? []).some((hint) => mime.includes(hint))) ?? null;
}

export function supportedExtensions(): string[] {
  return [...new Set(FILE_PARSERS.flatMap((p) => p.extensions))].sort();
}

export function supportedMimeHints(): string[] {
  return [...new Set(FILE_PARSERS.flatMap((p) => p.mimeHints ?? []))].sort();
}
