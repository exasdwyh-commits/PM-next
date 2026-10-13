/**
 * 图片与视频：**只读容器元信息，不读内容**。
 *
 * 这是本期明确的边界，写在注释里是为了防止后人误以为「解析器返回 READY 就读过内容了」：
 * 要看懂一张图或一段视频的画面，得过一遍视觉模型或 ASR，那是模型调用而非格式解析，
 * 成本、延迟和失败模式都完全不同。所以这里刻意只做「容器层」的事——
 * 尺寸、页数般的片长、有无音轨，并且**在 note 里写清楚内容还没读**。
 *
 * 判断规则：宁可返回 UNSUPPORTED 也不要返回空 READY。
 * 「没读出内容」和「不支持这格式」必须能被区分。
 */
import type { FileParseOutcome, FileParser, FileParserMeta, ParserInput } from "../types";

// ---------------------------------------------------------------------------
// 图片
// ---------------------------------------------------------------------------

function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10 || buf.toString("ascii", 0, 3) !== "GIF") return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** JPEG：逐个跳过段找 SOF0～SOF15（除 DHT/JPG/DAC 这几个无尺寸的）。 */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buf.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/** WebP：RIFF 容器里按 chunk 找 VP8 / VP8L / VP8X。 */
function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 16 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    const w = buf.readUIntLE(24, 3);
    const h = buf.readUIntLE(27, 3);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

const CONTENT_NOT_READ =
  "只登记了文件元信息；图片内容的识别需要视觉模型，本轮未提供，因此画面内容未被读取。";

const imageParser: FileParser = {
  id: "image",
  label: "图片",
  extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"],
  mimeHints: ["image/"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const buf = input.buffer;
    let meta: FileParserMeta | null = null;
    let format: string | undefined;

    const png = pngSize(buf);
    if (png) {
      meta = { ...png, imageFormat: "PNG" };
      format = "PNG";
    } else {
      const jpeg = jpegSize(buf);
      if (jpeg) {
        meta = { ...jpeg, imageFormat: "JPEG" };
        format = "JPEG";
      } else {
        const gif = gifSize(buf);
        if (gif) {
          meta = { ...gif, imageFormat: "GIF" };
          format = "GIF";
        } else {
          const webp = webpSize(buf);
          if (webp) {
            meta = { ...webp, imageFormat: "WebP" };
            format = "WebP";
          }
        }
      }
    }

    if (!meta) {
      return {
        status: "FAILED",
        kind: "image",
        text: "",
        meta: {},
        note: "扩展名是图片，但文件头不符合 PNG/JPEG/GIF/WebP 任一格式。",
      };
    }

    const lines = [
      `# 图片：${input.filename}`,
      `格式：${format}，尺寸 ${meta.width} × ${meta.height} 像素，文件 ${(input.byteSize / 1024).toFixed(1)} KB。`,
      "",
      "（这张图是作为附件一并提交的；Kern 没有读取它的画面内容。）",
    ];
    return { status: "READY", kind: "image", text: lines.join("\n"), meta, note: CONTENT_NOT_READ };
  },
};

// ---------------------------------------------------------------------------
// 视频 —— MP4 / MOV（ISO BMFF 同一套 box 结构）
// ---------------------------------------------------------------------------

interface Box {
  type: string;
  /** payload 起始偏移 */
  start: number;
  end: number;
}

/** 只做一层线性扫描，不做深递归：容纳 moov 的结构是固定的两层。 */
function readBoxes(buf: Buffer, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    let headerLength = 8;
    if (size === 1) {
      if (offset + 16 > to) break;
      const big = Number(buf.readBigUInt64BE(offset + 8));
      size = big;
      headerLength = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < headerLength || offset + size > to) break;
    boxes.push({ type, start: offset + headerLength, end: offset + size });
    offset += size;
  }
  return boxes;
}

function findMoov(buf: Buffer): Box | null {
  const headEnd = Math.min(buf.length, 1024 * 1024);
  const head = readBoxes(buf, 0, headEnd).find((b) => b.type === "moov");
  if (head) return head;
  // 未优化过的 MP4 把 moov 写在文件尾（边录边传的产物常见）
  const tailStart = Math.max(0, buf.length - 2 * 1024 * 1024);
  const tail = readBoxes(buf, tailStart, buf.length).find((b) => b.type === "moov");
  return tail ?? null;
}

function parseVideoMeta(buf: Buffer): FileParserMeta | null {
  const moov = findMoov(buf);
  if (!moov) return null;
  const meta: FileParserMeta = {};
  let timescale = 0;
  let duration = 0;

  for (const box of readBoxes(buf, moov.start, moov.end)) {
    if (box.type === "mvhd") {
      const version = buf[box.start];
      if (version === 1) {
        timescale = buf.readUInt32BE(box.start + 20);
        duration = Number(buf.readBigUInt64BE(box.start + 24));
      } else {
        timescale = buf.readUInt32BE(box.start + 12);
        duration = buf.readUInt32BE(box.start + 16);
      }
    } else if (box.type === "trak") {
      let width = 0;
      let height = 0;
      for (const child of readBoxes(buf, box.start, box.end)) {
        if (child.type === "tkhd") {
          const version = buf[child.start];
          const base = version === 1 ? child.start + 88 : child.start + 76;
          if (base + 8 <= child.end) {
            width = buf.readUInt32BE(base) / 65536;
            height = buf.readUInt32BE(base + 4) / 65536;
          }
        } else if (child.type === "hdlr") {
          const kind = buf.toString("ascii", child.start + 8, child.start + 12);
          if (kind === "soun") meta.hasAudioTrack = true;
          if (kind === "vide") {
            meta.videoCodec = buf.toString("ascii", child.start + 8, child.start + 12);
          }
        }
      }
      if (width > 0 && height > 0) {
        meta.width = Math.round(width);
        meta.height = Math.round(height);
      }
    }
  }

  if (timescale > 0 && duration > 0) meta.durationSec = Math.round((duration / timescale) * 10) / 10;
  return meta.width || meta.durationSec ? meta : null;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h} 小时 ${m} 分 ${s} 秒`
    : `${m} 分 ${s} 秒`;
}

const videoParser: FileParser = {
  id: "video",
  label: "视频",
  extensions: [".mp4", ".mov", ".m4v", ".webm"],
  mimeHints: ["video/"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const isWebm = input.filename.toLowerCase().endsWith(".webm")
      || input.buffer.toString("hex", 0, 4) === "1a45dfa3";
    const meta = isWebm ? null : parseVideoMeta(input.buffer);

    if (!meta) {
      // 这不算失败：文件本身没问题，是这一层没能力读懂内容
      return {
        status: "UNSUPPORTED",
        kind: "video",
        text: "",
        meta: {},
        note: isWebm
          ? "WebM 容器暂未实现时长与音轨解析，只登记了文件信息。"
          : "没能定位 mp4/mov 的 moov 索引块，无法读出时长与分辨率。",
      };
    }

    const facts: string[] = [];
    if (meta.durationSec) facts.push(`时长 ${formatDuration(meta.durationSec)}`);
    if (meta.width && meta.height) facts.push(`分辨率 ${meta.width} × ${meta.height}`);
    facts.push(meta.hasAudioTrack ? "含音轨" : "未检测到音轨");

    const lines = [
      `# 视频：${input.filename}`,
      `${facts.join("，")}，文件 ${(input.byteSize / 1024 / 1024).toFixed(1)} MB。`,
      "",
      "（这是一段视频附件；Kern 只登记了它的容器信息，没有读取画面与声音。）",
    ];
    return {
      status: "READY",
      kind: "video",
      text: lines.join("\n"),
      meta,
      note: "只登记容器元信息；画面与音频内容需要抽帧、视觉识别或语音转写，本轮未提供。",
    };
  },
};

export const mediaParsers: FileParser[] = [imageParser, videoParser];
