import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import { validateKernConversationRuntimeConfig } from "./conversation-config";

export async function listKernConversations(
  session: SessionContext,
  options?: { productId?: string | null }
) {
  const where: {
    organizationId: string;
    ownerId: string;
    archivedAt: null;
    productId?: string | null;
  } = {
    organizationId: session.organizationId,
    ownerId: session.userId,
    archivedAt: null,
  };
  if (options?.productId !== undefined) where.productId = options.productId;

  return prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, role: true },
      },
      _count: { select: { messages: true } },
    },
  });
}

export async function createKernConversation(
  session: SessionContext,
  params: {
    title?: string;
    productId?: string | null;
    runtimeConfig?: unknown;
    clientConversationId?: unknown;
  }
) {
  const clientId = params.clientConversationId;
  if (clientId !== undefined && (typeof clientId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId))) throw new UnprocessableEntityError("会话标识无效");
  const title = params.title?.trim() || "新对话";
  const runtimeConfig =
    params.runtimeConfig === undefined
      ? null
      : await validateKernConversationRuntimeConfig(session, params.runtimeConfig);
  const data: Prisma.ConversationUncheckedCreateInput = {
      organizationId: session.organizationId,
      ownerId: session.userId,
      kind: params.productId ? "PRODUCT" : "ADVISOR",
      title,
      productId: params.productId || null,
      ...(runtimeConfig ? { runtimeConfig: runtimeConfig as any } : {}),
    };
  if (typeof clientId !== "string") return prisma.conversation.create({ data });
  /**
   * 幂等建会话：同一个 clientConversationId 只允许建出一条。
   *
   * 不能用 upsert 的「先读后写」。Prisma 6 在这里走的是 SELECT + INSERT 两步（不是数据库
   * 原生 upsert），READ COMMITTED 下并发调用会双双读空、双双 INSERT，其中一方撞唯一键抛
   * P2002。CI supervisor 流水线实测过：`Invalid tx.conversation.upsert() invocation …
   * Unique constraint failed on the fields: (id)`，触发点正是 ME1 的 5 路并发建会话
   * （tests/regression-kern-message-execution.ts:47）。本地 30 路并发压测同样稳定复现。
   *
   * 改为「直接 INSERT + 撞键即回读」，用数据库的唯一约束本身当互斥量：并发下只有一条
   * INSERT 得手，其余阻塞到它提交后拿到 P2002，再回读那条已存在的行。
   * 与 acceptKernMessage 用 SELECT … FOR UPDATE 表达的是同一件事 —— 建会话时目标行还不存在、
   * 锁不住，唯一约束就是那把锁。
   */
  try {
    const created = await prisma.conversation.create({ data: { ...data, id: clientId } });
    return created;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  // 走到这里说明该会话已由并发的另一次调用建出（或早已存在）。回读并做同等的归属校验，
  // 语义与原先 upsert 的 update: {} 一致 —— 命中已有会话时不得改写它的 title / runtimeConfig。
  const existing = await prisma.conversation.findUnique({ where: { id: clientId } });
  if (!existing || existing.organizationId !== session.organizationId || existing.ownerId !== session.userId) {
    throw new NotFoundError("Conversation not found");
  }
  return existing;
}

/**
 * E2a · 会话管理：重命名 / 归档 / 恢复。
 * 边界：owner-only（同 getKernConversation 的租户 + 归属校验语义）。
 * 重命名允许空串 → 回落到「新对话」默认名（与 createKernConversation 一致）。
 * 已归档会话不再出现在默认列表；恢复不清理 messages（归档可逆，删除是另一件事且当前不提供）。
 */
export async function renameKernConversation(
  session: SessionContext,
  conversationId: string,
  title: string
) {
  await requireOwnedKernConversation(session, conversationId);
  const nextTitle = title.trim() || "新对话";
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { title: nextTitle },
  });
}

export async function archiveKernConversation(
  session: SessionContext,
  conversationId: string,
  archived: boolean
) {
  await requireOwnedKernConversation(session, conversationId);
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { archivedAt: archived ? new Date() : null },
  });
}

/** owner-only 校验：不存在 / 跨组织 / 他人会话一律 NotFound（不泄漏存在性）。 */
async function requireOwnedKernConversation(session: SessionContext, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, organizationId: true, ownerId: true },
  });
  if (
    !conversation ||
    conversation.organizationId !== session.organizationId ||
    conversation.ownerId !== session.userId
  ) {
    throw new NotFoundError("Conversation not found");
  }
  return conversation;
}

export async function getKernConversation(
  session: SessionContext,
  conversationId: string
) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { toolCalls: true },
      },
    },
  });

  if (
    !conversation ||
    conversation.organizationId !== session.organizationId ||
    conversation.ownerId !== session.userId
  ) {
    throw new NotFoundError("Conversation not found");
  }
  const unfinished = await prisma.agentRun.findMany({ where: { conversationId, clientMessageId: { not: null }, status: { in: ["QUEUED", "RUNNING", "CANCELLED"] }, outputMessageId: { not: null } }, select: { outputMessageId: true } });
  const hidden = new Set(unfinished.map(r => r.outputMessageId));
  return { ...conversation, messages: conversation.messages.filter(m => !hidden.has(m.id)) };
}
