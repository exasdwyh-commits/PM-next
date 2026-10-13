/**
 * 文件读取模块的公共出口。
 *
 * 对外只有一个入口函数 `parseAttachment`，并且它**永不抛错**：
 * 上传流程里解析是第三步（落盘、入库之后），抛异常会把前面已成的操作一起卷掉。
 * 解析能否失败、为什么失败，都是要写进数据库给用户看的**数据**，不是异常。
 */
import type { FileParseOutcome, ParserInput } from "./types";
import { MAX_EXTRACTED_CHARS, MAX_FILES_PER_MESSAGE, MAX_UPLOAD_BYTES, SUPPORTED_LABELS } from "./limits";
import { FILE_PARSERS, extensionOf, parserForExtension, parserForMime, supportedExtensions, supportedMimeHints } from "./registry";

export type { FileParseOutcome, FileParser, FileParserMeta, ParsedFileKind, ParserInput } from "./types";
export {
  MAX_EXTRACTED_CHARS,
  MAX_FILES_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  SUPPORTED_LABELS,
} from "./limits";
export {
  FILE_PARSERS,
  extensionOf,
  parserForExtension,
  parserForMime,
  supportedExtensions,
  supportedMimeHints,
} from "./registry";

/** 格式不在注册表里时的统一回答：明确 UNSUPPORTED，不假装读过。 */
function unsupported(input: ParserInput): FileParseOutcome {
  const ext = extensionOf(input.filename);
  return {
    status: "UNSUPPORTED",
    kind: null,
    text: "",
    meta: {},
    note: `暂不支持读取 ${ext || "该"} 格式，只登记了文件信息。目前可读取：${SUPPORTED_LABELS.map((s) => s.extensions.join("/")).join("、")}。`,
  };
}

/**
 * 解析一个已读入内存的文件。任何异常都收敛成 FAILED 结果，附带可读原因。
 */
export async function parseAttachment(input: ParserInput): Promise<FileParseOutcome> {
  const parser = parserForExtension(input.filename) ?? parserForMime(input.mimeType);
  if (!parser) return unsupported(input);
  try {
    const outcome = await parser.parse(input);
    if (input.byteSize <= 0 || !input.buffer.length) {
      return {
        status: "FAILED",
        kind: parser.id,
        text: "",
        meta: {},
        note: "文件为空，没有可读取的内容。",
      };
    }
    return outcome;
  } catch (error) {
    return {
      status: parser.id === "image" || parser.id === "video" ? "UNSUPPORTED" : "FAILED",
      kind: parser.id,
      text: "",
      meta: {},
      note: `解析 ${parser.label} 时出错：${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
    };
  }
}
