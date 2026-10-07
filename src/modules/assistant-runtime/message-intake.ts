import { randomUUID } from "node:crypto";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { getWorkerHealth } from "@/modules/worker/heartbeat";

export const MAX_MESSAGE_LENGTH = 40_000;
export function validateClientMessageId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new UnprocessableEntityError("消息标识无效，请刷新页面后重试");
  return value;
}
function view(run: { id: string; status: string; clientMessageId: string | null; inputMessageId: string | null; outputMessageId: string | null; createdAt: Date; errorReason: string | null }) {
  return { runId: run.id, status: run.status, clientMessageId: run.clientMessageId, inputMessageId: run.inputMessageId, outputMessageId: run.outputMessageId, createdAt: run.createdAt.toISOString(), error: run.status === "FAILED" || run.status === "CANCELLED" ? run.errorReason : null };
}
const select = { id: true, status: true, clientMessageId: true, inputMessageId: true, outputMessageId: true, createdAt: true, errorReason: true } as const;

/** Persist acceptance and its user message together. Replays never invoke a model. */
export async function acceptKernMessage(session: SessionContext, conversationId: string, input: { content: unknown; clientMessageId: unknown }) {
  const clientMessageId = validateClientMessageId(input.clientMessageId);
  if (typeof input.content !== "string" || !input.content.trim() || input.content.length > MAX_MESSAGE_LENGTH) throw new UnprocessableEntityError(`消息必须为 1～${MAX_MESSAGE_LENGTH} 字符的文本`);
  const content = input.content.trim();
  const accepted = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId } });
    if (!conversation) throw new NotFoundError("Conversation not found");
    const existing = await tx.agentRun.findUnique({ where: { conversationId_clientMessageId: { conversationId, clientMessageId } }, select });
    if (existing) {
      const message = await tx.message.findUnique({ where: { id: existing.inputMessageId! } });
      if (message?.content !== content) throw new ConflictError("这个消息标识已用于另一条内容");
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

