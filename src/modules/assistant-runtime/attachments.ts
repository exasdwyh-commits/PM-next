/**
 * 对话附件的编排层：落盘 → 解析 → 入库 → 给 prompts 层供货。
 *
 * 这里只做**编排**，格式活全在 `modules/file-intake`（那边一行 Prisma 都没有）。
 * 分工的理由是：解析能力要能被单独测、单独复用（比如将来给其它入口读文件），
 * 而它没必要知道文件名后缀白名单、租户隔离与审计——三件事混在一起就没法测了。
 *
 * 三条刻意的取舍：
 *  1. **上传即解析**。用户在按下发送之前就想知道「这份材料读得了吗」，
 *     而不是等一轮对话跑完才看到「解析失败」。代价是上传接口慢一些，我们认了。
 *  2. **失败不上抛**。解析失败是这份材料的**属性**，要写进库里显示给用户，
 *     不能让整个上传 HTTP 500——那样用户连「哪些传成功了」都不知道。
 *  3. **fileKey 不出口**。下载走独立接口，客户端拿到存储键没有正当用途，
 *     只会让路径结构和名字前缀泄漏出去（`projects/[id]/attachments` 那条老路有前车之鉴）。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AttachmentParseStatus, KnowledgeSourceKind, type Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import {
  MAX_FILES_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  extensionOf,
  parseAttachment,
  supportedExtensions,
} from "@/modules/file-intake";
import { chunkMarkdownByHeadings } from "@/modules/knowledge/sync";

const UPLOAD_ROOT = path.join(process.cwd(), ".uploads", "conversations");

export const ATTACHMENT_PUBLIC_SELECT = {
  id: true,
  originalFilename: true,
  mimeType: true,
  byteSize: true,
  parseStatus: true,
  parsedKind: true,
  extractedMeta: true,
  parseNote: true,
  indexForSearch: true,
  createdAt: true,
} as const;

/** 清单 view：多带一小段预览，供输入框上方已选文件的气泡显示。 */
const PREVIEW_CHARS = 160;

function publicView(row: {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  parseStatus: AttachmentParseStatus;
  parsedKind: string | null;
  extractedMeta: unknown;
  parseNote: string | null;
  indexForSearch: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    parseStatus: row.parseStatus,
    parsedKind: row.parsedKind,
    extractedMeta: row.extractedMeta,
    parseNote: row.parseNote,
    indexForSearch: row.indexForSearch,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 校验「这个人对这个会话有上传资格」。
 *
 * 单独导出是为了让接口层能在**读请求体之前**先过一遍归属：
 * 顺序反了的话，非本人会话会因为 content-type 不对先抛 415，
 * 越权探测就变成了「内容类型错误」——既是错误码失真，也让 multipart 解析
 * 白白跑在没权限的请求上。
 */
export async function assertConversationAttachmentAccess(
  session: SessionContext,
  conversationId: string
) {
  return assertConversationOwner(session, conversationId);
}

async function assertConversationOwner(session: SessionContext, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
  if (conversation.archivedAt) throw new ForbiddenError("会话已归档，不能上传附件");
  return conversation;
}

// ---------------------------------------------------------------------------
// 上传
// ---------------------------------------------------------------------------

export interface UploadResult {
  ok: boolean;
  attachment?: ReturnType<typeof publicView> & { preview?: string };
  error?: string;
}

export async function uploadConversationAttachments(
  session: SessionContext,
  conversationId: string,
  files: File[],
  options: { indexForSearch?: boolean } = {}
): Promise<{ uploads: UploadResult[] }> {
  await assertConversationOwner(session, conversationId);

  const accepted = files.slice(0, MAX_FILES_PER_MESSAGE);
  const uploads: UploadResult[] = [];

  for (const file of accepted) {
    const name = file.name || "未命名文件";
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        uploads.push({ ok: false, error: `${name}：超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 上限` });
        continue;
      }
      if (file.size === 0) {
        uploads.push({ ok: false, error: `${name}：空文件，无需上传` });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const ext = extensionOf(name);

      // 解析在写库之前完成：状态是一次写对的，不留「待后台补」的中间态
      const outcome = await parseAttachment({
        buffer,
        filename: name,
        mimeType: file.type || "",
        byteSize: buffer.length,
      });

      await fs.mkdir(UPLOAD_ROOT, { recursive: true });
      const fileKey = `${hash.slice(0, 16)}_${Date.now()}${ext}`;
      await fs.writeFile(path.join(UPLOAD_ROOT, fileKey), buffer);

      const row = await prisma.conversationAttachment.create({
        data: {
          conversationId,
          organizationId: session.organizationId,
          uploadedById: session.userId,
          originalFilename: name,
          mimeType: file.type || "application/octet-stream",
          byteSize: buffer.length,
          hash,
          fileKey,
          parseStatus: outcome.status,
          parsedKind: outcome.kind,
          extractedText: outcome.text || null,
          extractedMeta: outcome.meta as never,
          parseNote: outcome.note ?? null,
          parsedAt: new Date(),
          indexForSearch: Boolean(options.indexForSearch),
        },
        select: ATTACHMENT_PUBLIC_SELECT,
      });

      await prisma.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "CONVERSATION_ATTACHMENT_UPLOADED",
          objectType: "ConversationAttachment",
          objectId: row.id,
          summary: `对话附件「${name}」（${(buffer.length / 1024).toFixed(1)}KB）${outcome.status === "READY" ? "解析成功" : outcome.status === "UNSUPPORTED" ? "格式不支持" : "解析失败"}`,
        },
      });

      // 勾选了长期检索的，写完库就灌进知识表；失败不影响上传结果本身
      if (options.indexForSearch && outcome.text) {
        await indexAttachmentForSearch(row.id).catch(() => null);
      }

      uploads.push({
        ok: true,
        attachment: {
          ...publicView(row),
          preview: outcome.text ? outcome.text.slice(0, PREVIEW_CHARS) : undefined,
        },
      });
    } catch (error) {
      uploads.push({
        ok: false,
        error: `${name}：${error instanceof Error ? error.message.slice(0, 160) : String(error)}`,
      });
    }
  }

  return { uploads };
}

// ---------------------------------------------------------------------------
// 列表 / 删除
// ---------------------------------------------------------------------------

export async function listConversationAttachments(session: SessionContext, conversationId: string) {
  await assertConversationOwner(session, conversationId);
  const rows = await prisma.conversationAttachment.findMany({
    where: { conversationId, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
    select: ATTACHMENT_PUBLIC_SELECT,
  });
  return rows.map(publicView);
}

export async function removeConversationAttachment(
  session: SessionContext,
  conversationId: string,
  attachmentId: string
) {
  const conversation = await assertConversationOwner(session, conversationId);
  void conversation;
  const row = await prisma.conversationAttachment.findFirst({
    where: { id: attachmentId, conversationId, organizationId: session.organizationId },
    select: { id: true, fileKey: true, originalFilename: true, indexForSearch: true, messageId: true },
  });
  if (!row) throw new NotFoundError("Attachment not found");
  // 已随消息发出去的材料成为那轮对话的依据，抽走会让历史回答失去出处
  if (row.messageId) throw new ConflictError("这份材料已随消息发出，不能撤下");

  if (row.indexForSearch) await unindexAttachment(row.id).catch(() => null);
  await prisma.conversationAttachment.delete({ where: { id: row.id } });

  // 磁盘清理失败不该让删除失败：库里的记录已经消失，孤儿文件由运维清理
  await fs.unlink(path.join(UPLOAD_ROOT, row.fileKey)).catch(() => null);
  return { id: row.id, removed: true };
}

// ---------------------------------------------------------------------------
// 绑定到用户消息
// ---------------------------------------------------------------------------

/**
 * 把上传好的附件挂到某条用户消息上。
 *
 * 只接受**本会话、本组织、当前还没挂在任何消息上**的附件：
 * 上传接口与消息接口是两次请求，中间这段时间任何人都可能猜到 id，
 * 所以这里必须自己再核一遍归属，不能假定「前端只可能传自己的」。
 */
export async function bindAttachmentsToMessage(
  client: Prisma.TransactionClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  attachmentIds: string[]
) {
  const ids = [...new Set(attachmentIds)].slice(0, MAX_FILES_PER_MESSAGE);
  if (!ids.length) return 0;
  const result = await client.conversationAttachment.updateMany({
    where: {
      id: { in: ids },
      conversationId,
      organizationId,
      messageId: null,
    },
    data: { messageId },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// 长期检索（显式勾选才做）
// ---------------------------------------------------------------------------

const VIRTUAL_ROOT = ".uploads/conversations";

/**
 * 取得（或惰性创建）本组织唯一的「对话附件」知识源。
 *
 * 为什么不按会话建一个源：`searchKnowledge` 是按 `source.enabled` 做总闸过滤的，
 * 会话一多就到处都是源，用户没法一次性关掉；而且知识源在语义上是「一类去处」，
 * 不是「一次上传」。所以这里收敛成一个，`rootPath` 记枢要位置备查。
 */
async function ensureUploadSource(organizationId: string) {
  const existing = await prisma.knowledgeSource.findFirst({
    where: { organizationId, kind: KnowledgeSourceKind.CONVERSATION_UPLOAD },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.knowledgeSource.create({
    data: {
      organizationId,
      kind: KnowledgeSourceKind.CONVERSATION_UPLOAD,
      name: "对话附件",
      rootPath: VIRTUAL_ROOT,
      enabled: true,
    },
    select: { id: true },
  });
  return created.id;
}

export async function indexAttachmentForSearch(attachmentId: string): Promise<void> {
  const row = await prisma.conversationAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      organizationId: true,
      originalFilename: true,
      extractedText: true,
      hash: true,
      byteSize: true,
      indexForSearch: true,
    },
  });
  if (!row || !row.indexForSearch || !row.extractedText) return;

  const sourceId = await ensureUploadSource(row.organizationId);
  // 同一附件重复入库时幂等：先清掉旧切片，避免内容更新后新旧条目互相打架
  const existingDoc = await prisma.knowledgeDocument.findUnique({
    where: { sourceId_relativePath: { sourceId, relativePath: row.id } },
    select: { id: true, contentHash: true },
  });
  if (existingDoc?.contentHash === row.hash) return;

  const title = row.originalFilename.replace(/\.[^.]+$/, "");
  const chunks = chunkMarkdownByHeadings(row.extractedText, title);
  const doc = existingDoc
    ? existingDoc
    : await prisma.knowledgeDocument.create({
        data: {
          sourceId,
          organizationId: row.organizationId,
          relativePath: row.id,
          title,
          contentHash: row.hash,
          byteSize: row.byteSize,
        },
        select: { id: true },
      });

  await prisma.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
  if (chunks.length) {
    await prisma.knowledgeChunk.createMany({
      data: chunks.map((c) => ({
        documentId: doc.id,
        organizationId: row.organizationId,
        chunkIndex: c.chunkIndex,
        headingPath: c.headingPath,
        content: c.content,
        tokens: Math.ceil(c.content.length / 2),
      })),
    });
  }
  await prisma.conversationAttachment.update({
    where: { id: row.id },
    data: { indexedAt: new Date() },
  });
}

export async function unindexAttachment(attachmentId: string): Promise<void> {
  const row = await prisma.conversationAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, organizationId: true },
  });
  if (!row) return;
  const source = await prisma.knowledgeSource.findFirst({
    where: { organizationId: row.organizationId, kind: KnowledgeSourceKind.CONVERSATION_UPLOAD },
    select: { id: true },
  });
  if (!source) return;
  // KnowledgeDocument 上的 onDelete: Cascade 会连带清掉 chunks
  await prisma.knowledgeDocument.deleteMany({ where: { sourceId: source.id, relativePath: row.id } });
}

// ---------------------------------------------------------------------------
// 给 prompts 层供货
// ---------------------------------------------------------------------------

/** 本轮附件可用的正文预算；历史附件另算，避免互相挤。 */
const CURRENT_TEXT_BUDGET = 60_000;
const HISTORY_TEXT_BUDGET = 30_000;

function clamp(text: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false };
  return { text: text.slice(0, budget), truncated: true };
}

export interface AttachmentTurnContext {
  prompt: string;
  counts: { total: number; readable: number; unsupported: number };
}

/**
 * 组装「本会话材料」这一层上下文。
 *
 * 分层给而不一次性塞全文：本轮传的给足预算，更早传过的只给节选 + 清单。
 * 这样用户追问「上次那份材料里怎么写的」还有得答，又不会让三轮之前的附件
 * 占掉本轮材料的空间。
 */
export async function buildAttachmentPrompt(
  conversationId: string,
  organizationId: string,
  currentMessageId: string
): Promise<AttachmentTurnContext> {
  const rows = await prisma.conversationAttachment.findMany({
    where: { conversationId, organizationId, messageId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalFilename: true,
      parsedKind: true,
      parseStatus: true,
      extractedText: true,
      extractedMeta: true,
      parseNote: true,
      messageId: true,
    },
  });

  const current = rows.filter((r) => r.messageId === currentMessageId);
  const history = rows.filter((r) => r.messageId !== currentMessageId);
  const counts = {
    total: current.length,
    readable: current.filter((r) => r.parseStatus === "READY" && r.extractedText).length,
    unsupported: current.filter((r) => r.parseStatus !== "READY").length,
  };

  if (!current.length && !history.length) return { prompt: "", counts };

  const lines: string[] = [
    "## 用户随消息提交的材料（Conversation Attachments）",
    "以下正文由系统从用户上传的文件中提取，**是这一轮的可用事实来源之一**，可以与工具数据、知识库结果互相印证。",
    "硬约束：区分「文件里写了什么」与「文件里没有写」——没有写的部分不要推测；被截断的部分不得当作全文使用。",
  ];

  if (current.length) {
    lines.push("", `### 本轮附带的 ${current.length} 份材料`);
    for (const row of current) {
      lines.push("", `#### ${row.originalFilename}（${describeMeta(row.extractedMeta)}）`);
      if (row.parseNote) lines.push(`> 解析说明：${row.parseNote}`);
      if (row.extractedText) {
        const { text, truncated } = clamp(row.extractedText, CURRENT_TEXT_BUDGET);
        if (truncated) lines.push(`> 正文较长，以下是前 ${CURRENT_TEXT_BUDGET} 字。`);
        lines.push(text);
      } else {
        lines.push("（这份材料没有提取到可读正文。）");
      }
    }
  }

  if (history.length) {
    lines.push(
      "",
      `### 本会话更早上传过的 ${history.length} 份材料（正文为节选，仅供参考）`
    );
    for (const row of history.slice(0, 6)) {
      const excerpt = row.extractedText
        ? clamp(row.extractedText, HISTORY_TEXT_BUDGET).text.replace(/\s+/g, " ").slice(0, 600)
        : "（无可读正文）";
      lines.push(`- **${row.originalFilename}**：${excerpt}`);
    }
  }

  return { prompt: lines.join("\n"), counts };
}

function describeMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "未知格式";
  const m = meta as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.pageCount === "number") parts.push(`${m.pageCount} 页`);
  if (typeof m.slideCount === "number") parts.push(`${m.slideCount} 页幻灯片`);
  if (Array.isArray(m.sheetNames) && m.sheetNames.length) parts.push(`${m.sheetNames.length} 个工作表`);
  if (typeof m.rowCount === "number") parts.push(`${m.rowCount} 行段落`);
  if (typeof m.durationSec === "number") parts.push(`${m.durationSec} 秒`);
  if (typeof m.width === "number" && typeof m.height === "number") parts.push(`${m.width}×${m.height}`);
  return parts.length ? parts.join(" / ") : "已解析";
}

export { MAX_FILES_PER_MESSAGE, MAX_UPLOAD_BYTES, supportedExtensions };

/** 解析器的 attaches → 前端可用的格式清单。 */
export function supportedFormats(): { extensions: string[]; maxBytes: number; maxPerMessage: number } {
  return {
    extensions: supportedExtensions(),
    maxBytes: MAX_UPLOAD_BYTES,
    maxPerMessage: MAX_FILES_PER_MESSAGE,
  };
}

export const UPLOAD_LIMIT_ERROR_HINT = `单次最多 ${MAX_FILES_PER_MESSAGE} 个文件，单个不超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB。`;
