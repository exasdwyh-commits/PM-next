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
  indexedAt: true,
  messageId: true,
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
  indexedAt: Date | null;
  messageId: string | null;
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
    indexedAt: row.indexedAt?.toISOString() ?? null,
    sent: row.messageId !== null,
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
    let stagedPath: string | null = null;
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
      const fileKey = `${crypto.randomUUID()}${ext}`;
      stagedPath = path.join(UPLOAD_ROOT, fileKey);
      await fs.writeFile(stagedPath, buffer, { flag: "wx" });

      let row = await prisma.$transaction(async tx => {
        const created = await tx.conversationAttachment.create({
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

        await tx.auditEvent.create({
          data: {
            actorId: session.userId,
            action: "CONVERSATION_ATTACHMENT_UPLOADED",
            objectType: "ConversationAttachment",
            objectId: created.id,
            summary: `对话附件「${name}」（${(buffer.length / 1024).toFixed(1)}KB）${outcome.status === "READY" ? "解析成功" : outcome.status === "UNSUPPORTED" ? "格式不支持" : "解析失败"}`,
          },
        });

        return created;
      });
      stagedPath = null;
      // 上传与长期索引分开反馈：索引失败仍保留可用于本轮的材料，并允许重试。
      if (options.indexForSearch && outcome.text) {
        try {
          await indexAttachmentForSearch(row.id);
          row = await prisma.conversationAttachment.findUniqueOrThrow({ where: { id: row.id }, select: ATTACHMENT_PUBLIC_SELECT });
        } catch {
          console.error("[attachments] Long-term indexing failed", row.id);
        }
      }

      uploads.push({
        ok: true,
        attachment: {
          ...publicView(row),
          preview: outcome.text ? outcome.text.slice(0, PREVIEW_CHARS) : undefined,
        },
      });
    } catch (error) {
      if (stagedPath) {
        await fs.unlink(stagedPath).catch(() => console.error("[attachments] Staged file cleanup failed", path.basename(stagedPath!)));
      }
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

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attachment-index:${session.organizationId}`}))`;
    const latest = await tx.conversationAttachment.findUnique({ where: { id: row.id } });
    if (!latest) throw new NotFoundError("Attachment not found");
    if (latest.messageId) throw new ConflictError("这份材料已随消息发出，不能撤下");
    await tx.knowledgeDocument.deleteMany({ where: {
      organizationId: session.organizationId, relativePath: row.id,
      source: { kind: KnowledgeSourceKind.CONVERSATION_UPLOAD },
    } });
    await tx.conversationAttachment.delete({ where: { id: row.id } });
  });
  // 保留删除结果，同时明确反馈磁盘清理是否完成。
  let storageCleanupPending = false;
  try { await fs.unlink(path.join(UPLOAD_ROOT, row.fileKey)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      storageCleanupPending = true;
      console.error("[attachments] Removed file cleanup pending", row.id);
    }
  }
  return { id: row.id, removed: true, storageCleanupPending };
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
  const ids = [...new Set(attachmentIds)];
  if (ids.length > MAX_FILES_PER_MESSAGE) throw new ConflictError(`单条消息最多附带 ${MAX_FILES_PER_MESSAGE} 份附件`);
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
  if (result.count !== ids.length) {
    throw new ConflictError("附件不存在、已用于另一条消息或不属于当前会话，请重新选择材料");
  }
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
async function ensureUploadSource(organizationId: string, client: Prisma.TransactionClient) {
  const existing = await client.knowledgeSource.findFirst({
    where: { organizationId, kind: KnowledgeSourceKind.CONVERSATION_UPLOAD },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await client.knowledgeSource.create({
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

  const title = row.originalFilename.replace(/\.[^.]+$/, "");
  const chunks = chunkMarkdownByHeadings(row.extractedText, title);
  await prisma.$transaction(async tx => {
    // 同组织的虚拟源创建与附件索引串行，防止并发建立多个来源或重复切片。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attachment-index:${row.organizationId}`}))`;
    const latest = await tx.conversationAttachment.findUnique({ where: { id: row.id } });
    if (!latest?.indexForSearch) return;
    const sourceId = await ensureUploadSource(row.organizationId, tx);
    const doc = await tx.knowledgeDocument.upsert({
      where: { sourceId_relativePath: { sourceId, relativePath: row.id } },
      create: { sourceId, organizationId: row.organizationId, relativePath: row.id, title, contentHash: row.hash, byteSize: row.byteSize },
      update: { title, contentHash: row.hash, byteSize: row.byteSize, deletedAt: null, indexedAt: new Date() },
      select: { id: true },
    });
    await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
    if (chunks.length) await tx.knowledgeChunk.createMany({ data: chunks.map(c => ({
      documentId: doc.id, organizationId: row.organizationId, chunkIndex: c.chunkIndex,
      headingPath: c.headingPath, content: c.content, tokens: Math.ceil(c.content.length / 2),
    })) });
    await tx.conversationAttachment.update({ where: { id: row.id }, data: { indexedAt: new Date() } });
  });
}

export async function setConversationAttachmentSearch(
  session: SessionContext, conversationId: string, attachmentId: string, enabled: boolean
) {
  await assertConversationOwner(session, conversationId);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attachment-index:${session.organizationId}`}))`;
    const row = await tx.conversationAttachment.findFirst({ where: { id: attachmentId, conversationId, organizationId: session.organizationId } });
    if (!row) throw new NotFoundError("Attachment not found");
    if (row.messageId) throw new ConflictError("这份材料已随消息发出，不能更改检索设置");
    if (!enabled) await tx.knowledgeDocument.deleteMany({ where: {
      organizationId: session.organizationId, relativePath: row.id, source: { kind: KnowledgeSourceKind.CONVERSATION_UPLOAD },
    } });
    await tx.conversationAttachment.update({ where: { id: row.id }, data: { indexForSearch: enabled, indexedAt: null } });
  });
  if (enabled) {
    try { await indexAttachmentForSearch(attachmentId); }
    catch { throw new ConflictError("材料已保留，但长期检索写入失败，请重试"); }
  }
  return publicView(await prisma.conversationAttachment.findUniqueOrThrow({ where: { id: attachmentId }, select: ATTACHMENT_PUBLIC_SELECT }));
}

export async function readConversationAttachment(session: SessionContext, conversationId: string, attachmentId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId }, select: { id: true } });
  if (!conversation) throw new NotFoundError("Conversation not found");
  const row = await prisma.conversationAttachment.findFirst({ where: { id: attachmentId, conversationId, organizationId: session.organizationId } });
  if (!row) throw new NotFoundError("Attachment not found");
  try {
    return { bytes: await fs.readFile(path.join(UPLOAD_ROOT, row.fileKey)), filename: row.originalFilename };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("附件文件已不可用");
    throw error;
  }
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

/**
 * 本轮所有附件正文**共享**的预算（字符数）。
 *
 * 原来是每份各 60,000：8 份材料实测拼出 480,455 字符的 prompt。
 * 现在整轮共用 60,000，按下面的 water-filling 分配。
 */
const CURRENT_TEXT_BUDGET = 60_000;
/** 历史附件最多展示几份（沿用旧行为的 6 席）。 */
const HISTORY_ATTACHMENT_LIMIT = 6;
/** 单份历史节选最多展示字符；历史节选总量天然 ≤ 6×600，不挤占本轮额度。 */
const HISTORY_EXCERPT_CHARS = 600;
/** 文件名展示上限：超出用 … 截断，来源仍可辨识。 */
const FILENAME_DISPLAY_LIMIT = 120;
/** 解析说明展示上限。 */
const PARSE_NOTE_LIMIT = 200;
/**
 * 附件层总长度上限（含标题、文件名、说明等全部开销），可测试：
 * 本轮正文 ≤60,000 ＋ 历史节选 ≤3,600 ＋ 8 份本轮开销约 3,500
 * ＋ 历史开销约 1,000 ＋ 框架约 300 → 70,000 兜底。
 * 正常分配到不了这里；超出则显式标注后截断，保证总 prompt 有界。
 */
export const ATTACHMENT_PROMPT_MAX_CHARS = 70_000;

/**
 * Water-filling 额度分配：短文件按需取用，余量让给长文件；长文件均分剩余。
 *
 * 为什么不用「先到先得」：第一份 80,000 字的材料会独自吃掉全部 60,000 预算，
 * 后面 7 份直接消失，模型还以为本轮只有一份材料。按长度从小到大走，
 * 短文件拿足、长文件均分剩下的——每份至少能露个头，分配结果可解释。
 *
 * 返回每份的字符配额（按输入顺序），总和 ≤ budget。
 */
function allocateTextBudget(lengths: number[], budget: number): number[] {
  const quotas = new Array<number>(lengths.length).fill(0);
  if (!lengths.length || budget <= 0) return quotas;
  const order = lengths.map((len, i) => ({ len, i })).sort((a, b) => a.len - b.len);
  let remaining = budget;
  let active = lengths.length;
  for (let k = 0; k < order.length; k++) {
    const share = Math.floor(remaining / active);
    if (order[k].len <= share) {
      quotas[order[k].i] = order[k].len;
      remaining -= order[k].len;
    } else {
      for (let j = k; j < order.length; j++) quotas[order[j].i] = share;
      break;
    }
    active -= 1;
  }
  return quotas;
}

function displayName(name: string): string {
  if (name.length <= FILENAME_DISPLAY_LIMIT) return name;
  return `${name.slice(0, FILENAME_DISPLAY_LIMIT)}…`;
}

function displayNote(note: string): string {
  if (note.length <= PARSE_NOTE_LIMIT) return note;
  return `${note.slice(0, PARSE_NOTE_LIMIT)}…`;
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
  const message = await prisma.message.findFirst({
    where: { id: currentMessageId, conversationId, conversation: { organizationId } },
    select: { id: true },
  });
  if (!message) return { prompt: "", counts: { total: 0, readable: 0, unsupported: 0 } };
  const current = await prisma.conversationAttachment.findMany({
    where: { conversationId, organizationId, messageId: currentMessageId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
  const counts = {
    total: current.length,
    readable: current.filter((r) => r.parseStatus === "READY" && r.extractedText).length,
    unsupported: current.filter((r) => r.parseStatus !== "READY").length,
  };

  // 队列顺序与 claimMessage / conversation-engine 一致：比较 AgentRun 的
  // (createdAt, id)，不能用随机的 Message.id 判断接受顺序。
  // 历史消息没有接受记录时，仅纳入严格早于本轮的材料；等时历史材料保守省略。
  // 在 SQL 层限制条数与正文长度，保留数据库时间精度且不加载全部历史正文。
  const history = await prisma.$queryRaw<Array<{ originalFilename: string; excerpt: string | null }>>`
    SELECT a."originalFilename",
           substring(a."extractedText" from 1 for ${HISTORY_EXCERPT_CHARS}::integer) AS excerpt
      FROM "ConversationAttachment" a
      JOIN "Message" m ON m.id = a."messageId" AND m."conversationId" = a."conversationId"
      JOIN "Message" cm ON cm.id = ${currentMessageId} AND cm."conversationId" = a."conversationId"
      LEFT JOIN "AgentRun" r ON r.id = m."runId" AND r."conversationId" = a."conversationId"
        AND r."organizationId" = a."organizationId"
      LEFT JOIN "AgentRun" cr ON cr.id = cm."runId" AND cr."inputMessageId" = cm.id
        AND cr."clientMessageId" IS NOT NULL AND cr."organizationId" = a."organizationId"
        AND cr."conversationId" = a."conversationId"
     WHERE a."conversationId" = ${conversationId} AND a."organizationId" = ${organizationId}
       AND m.role = 'USER' AND m.id <> cm.id
       AND (
         (cr.id IS NOT NULL AND (
           (r."clientMessageId" IS NOT NULL AND r."inputMessageId" = m.id
             AND (r."createdAt", r.id) < (cr."createdAt", cr.id))
           OR (r."clientMessageId" IS NULL AND m."createdAt" < cm."createdAt")
         ))
         OR (cr.id IS NULL AND m."createdAt" < cm."createdAt")
       )
     ORDER BY COALESCE(r."createdAt", m."createdAt") DESC, r.id DESC,
              a."createdAt" DESC, a.id DESC
     LIMIT ${HISTORY_ATTACHMENT_LIMIT}
  `;

  if (!current.length && !history.length) return { prompt: "", counts };

  const lines: string[] = [
    "## 用户随消息提交的材料（Conversation Attachments）",
    "以下正文由系统从用户上传的文件中提取，**是这一轮的可用事实来源之一**，可以与工具数据、知识库结果互相印证。",
    "硬约束：区分「文件里写了什么」与「文件里没有写」——没有写的部分不要推测；被截断的部分不得当作全文使用。",
  ];

  if (current.length) {
    lines.push("", `### 本轮附带的 ${current.length} 份材料（正文合计 ≤ ${CURRENT_TEXT_BUDGET} 字，按短优先分配）`);
    // 共享预算：短文件按需取用，余量让给长文件（water-filling）。
    const quotas = allocateTextBudget(
      current.map((r) => r.extractedText?.length ?? 0),
      CURRENT_TEXT_BUDGET
    );
    for (let i = 0; i < current.length; i++) {
      const row = current[i];
      lines.push("", `#### ${displayName(row.originalFilename)}（${describeMeta(row.extractedMeta)}）`);
      if (row.parseNote) lines.push(`> 解析说明：${displayNote(row.parseNote)}`);
      if (row.extractedText) {
        const quota = quotas[i];
        if (row.extractedText.length > quota) {
          lines.push(
            `> 这是第 ${i + 1}/${current.length} 份材料的节选：本轮 ${current.length} 份材料共用 ${CURRENT_TEXT_BUDGET} 字额度，本份分得 ${quota} 字（原文 ${row.extractedText.length} 字），不得当作全文使用。`
          );
          lines.push(row.extractedText.slice(0, quota));
        } else {
          lines.push(row.extractedText);
        }
      } else {
        lines.push("（这份材料没有提取到可读正文。）");
      }
    }
  }

  if (history.length) {
    lines.push(
      "",
      `### 本会话更早的 ${history.length} 份材料（各取前 ${HISTORY_EXCERPT_CHARS} 字（节选），仅供参考，不占本轮额度）`
    );
    for (const row of history) {
      const excerpt = row.excerpt
        ? row.excerpt.replace(/\s+/g, " ")
        : "（无可读正文）";
      lines.push(`- **${displayName(row.originalFilename)}**：${excerpt}`);
    }
  }

  let prompt = lines.join("\n");
  // 总长度兜底：正常分配到不了这里；超出则显式标注后截断，保证 prompt 有界。
  if (prompt.length > ATTACHMENT_PROMPT_MAX_CHARS) {
    const notice = `\n> （附件上下文超出 ${ATTACHMENT_PROMPT_MAX_CHARS} 字上限，已截断；被截掉的部分本轮不可见。）`;
    prompt = prompt.slice(0, ATTACHMENT_PROMPT_MAX_CHARS - notice.length) + notice;
  }

  return { prompt, counts };
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
