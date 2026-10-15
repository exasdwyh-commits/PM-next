import { randomUUID } from "node:crypto";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { getWorkerHealth } from "@/modules/worker/heartbeat";
import { bindAttachmentsToMessage, MAX_FILES_PER_MESSAGE } from "./attachments";

export const MAX_MESSAGE_LENGTH = 40_000;
export function validateClientMessageId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new UnprocessableEntityError("消息标识无效，请刷新页面后重试");
  return value;
}
function view(run: { id: string; status: string; clientMessageId: string | null; inputMessageId: string | null; outputMessageId: string | null; createdAt: Date; errorReason: string | null }) {
  return { runId: run.id, status: run.status, clientMessageId: run.clientMessageId, inputMessageId: run.inputMessageId, outputMessageId: run.outputMessageId, createdAt: run.createdAt.toISOString(), error: run.status === "FAILED" || run.status === "CANCELLED" ? run.errorReason : null };
}
const select = { id: true, status: true, clientMessageId: true, inputMessageId: true, outputMessageId: true, createdAt: true, errorReason: true } as const;

/**
 * 随消息提交的附件 id。
 *
 * 只校验形状（字符串数组 + 数量），不在这里查库：归属校验发生在事务里
 * 的 `bindAttachmentsToMessage`（它自己再核一次组织与会话），
 * 两道校验的意义不同——这里挡的是畸形输入，那里挡的是越权 id。
 */
function validateAttachmentIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new UnprocessableEntityError("附件列表格式无效");
  if (value.length > MAX_FILES_PER_MESSAGE) {
    throw new UnprocessableEntityError(`单条消息最多附带 ${MAX_FILES_PER_MESSAGE} 份材料`);
  }
  const ids = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length !== value.length) throw new UnprocessableEntityError("附件列表包含无效标识");
  return ids;
}

/** Persist acceptance and its user message together. Replays never invoke a model. */
export async function acceptKernMessage(
  session: SessionContext,
  conversationId: string,
  input: { content: unknown; clientMessageId: unknown; attachmentIds?: unknown }
) {
  const clientMessageId = validateClientMessageId(input.clientMessageId);
  if (typeof input.content !== "string" || !input.content.trim() || input.content.length > MAX_MESSAGE_LENGTH) throw new UnprocessableEntityError(`消息必须为 1～${MAX_MESSAGE_LENGTH} 字符的文本`);
  const content = input.content.trim();
  const attachmentIds = validateAttachmentIds(input.attachmentIds);
  const accepted = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId } });
    if (!conversation) throw new NotFoundError("Conversation not found");
    const existing = await tx.agentRun.findUnique({ where: { conversationId_clientMessageId: { conversationId, clientMessageId } }, select });
    if (existing) {
      const message = await tx.message.findUnique({ where: { id: existing.inputMessageId! } });
      if (message?.content !== content) throw new ConflictError("这个消息标识已用于另一条内容");
      const bound = await tx.conversationAttachment.findMany({
        where: { conversationId, organizationId: session.organizationId, messageId: message.id },
        select: { id: true },
      });
      const requested = new Set(attachmentIds);
      if (bound.length !== requested.size || bound.some(row => !requested.has(row.id))) {
        throw new ConflictError("这个消息标识已用于另一组附件，请重新发送");
      }
      return { execution: view(existing), message: message!, replayed: true };
    }
    if (conversation.archivedAt) throw new ConflictError("会话已归档，请恢复后发送");
    const messageId = randomUUID();
    const run = await tx.agentRun.create({ data: {
      organizationId: session.organizationId, userId: session.userId, conversationId,
      goal: content.slice(0, 200), status: "QUEUED", clientMessageId, inputMessageId: messageId,
      contextSnapshot: { schemaVersion: "kern-message/v1", runtimeOwner: "KERN_ASSISTANT", runtimeConfig: conversation.runtimeConfig ?? null },
    }, select });
    const message = await tx.message.create({ data: { id: messageId, conversationId, role: "USER", content, runId: run.id } });
    // 在事务内绑定：附件与这条消息同一事务提交，不能出现「消息已入厍、附件还悬空」
    // 的中间状态，否则后台读到一半材料也无从察觉是漏绑还是本就没有。
    if (attachmentIds.length) {
      await bindAttachmentsToMessage(tx, session.organizationId, conversationId, messageId, attachmentIds);
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return { execution: view(run), message, replayed: false };
  }, { maxWait: 10_000, timeout: 10_000 });
  const health = await getWorkerHealth(new Date(), { organizationId: session.organizationId, loop: "conversation" });
  return { ...accepted, runId: accepted.execution.runId, workerReady: health.status === "running" };
}

/** Owner-only read; the client recovers state without creating another execution. */
export async function listKernMessageExecutions(session: SessionContext, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId }, select: { id: true } });
  if (!conversation) throw new NotFoundError("Conversation not found");
  const runs = await prisma.agentRun.findMany({ where: { conversationId, organizationId: session.organizationId, userId: session.userId, clientMessageId: { not: null } }, orderBy: { createdAt: "desc" }, take: 200, select });
  const worker = await getWorkerHealth(new Date(), { organizationId: session.organizationId, loop: "conversation" });
  const pending = await prisma.agentRun.findMany({ where: { conversationId, organizationId: session.organizationId, userId: session.userId, clientMessageId: { not: null }, status: { in: ["QUEUED", "RUNNING"] } }, select });
  const combined = new Map([...runs, ...pending].map(run => [run.id, run]));
  return { executions: [...combined.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(view), workerReady: worker.status === "running" };
}

