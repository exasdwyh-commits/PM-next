/**
 * 文件读取栈的类型契约。
 *
 * 这一层刻意**不 import 任何 `src/` 里的东西**（只依赖 Node 内置与 npm 包）：
 * 文件解析是纯粹的格式活，和租户、权限、证据链无关。它只回答两个问题——
 * 「这是什么格式」和「里面的文字是什么」，其余裁决交给调用方。
 * 副作用是这个模块不会参与任何层间依赖，也不会把 inject 面带进格式码。
 */

/** 注册表能认出来的格式。与 Prisma 的 `parsedKind` 字符串一一对应（小写）。 */
export type ParsedFileKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "html"
  | "markdown"
  | "text"
  | "csv"
  | "json"
  | "image"
  | "video";

/** 结构化元信息。各解析器只填自己拿得到的字段，拿不到就不填，不补默认值。 */
export interface FileParserMeta {
  pageCount?: number;
  slideCount?: number;
  sheetNames?: string[];
  rowCount?: number;
  columnCount?: number;
  /** 文档/页面里识别出的标题层级，供调用方拼 loadPath */
  headings?: string[];
  /** 图片/视频像素尺寸 */
  width?: number;
  height?: number;
  /** 视频时长（秒） */
  durationSec?: number;
  /** 视频是否含音轨——决定『能不能只靠转写拿到内容』 */
  hasAudioTrack?: boolean;
  videoCodec?: string;
  imageFormat?: string;
}

export type FileParseStatus = "READY" | "UNSUPPORTED" | "FAILED";

export interface FileParseOutcome {
  status: FileParseStatus;
  /** 认出来的格式；UNSUPPORTED 时为 null */
  kind: ParsedFileKind | null;
  /** 提取出的正文，已按上限截断 */
  text: string;
  meta: FileParserMeta;
  /**
   * 给人和给模型的说明：不支持的原因、扫描型 PDF 提示、正文被截断的标记等。
   * 这里必须**如实说明没读到什么**——宁可写「未提取」，也不能让调用方
   * 把「没写 note」误读成「内容已完整读取」。
   */
  note?: string;
  /** 正文是否触及长度上限被截断 */
  truncated?: boolean;
}

export interface ParserInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  byteSize: number;
}

export interface FileParser {
  id: ParsedFileKind;
  label: string;
  /** 处理的扩展名，小写含点 */
  extensions: string[];
  /** 额外接受的 mime 片段（字符串包含匹配） */
  mimeHints?: string[];
  parse(input: ParserInput): Promise<FileParseOutcome>;
}
