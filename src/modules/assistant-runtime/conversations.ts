import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";

export async function listKernConversations(
  session: SessionContext,
  options?: { productId?: string | null }
) {
  const where = {
    organizationId: session.organizationId,
    ownerId: session.userId,
    archivedAt: null,
    ...(options?.productId !== undefined
      ? { productId: options.productId }
      : {}),
  };

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
  params: { title?: string; productId?: string | null }
) {
  const title = params.title?.trim() || "新对话";

  if (params.productId) {
    const product = await prisma.product.findFirst({
      where: {
        id: params.productId,
        organizationId: session.organizationId,
      },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundError("Product not found");
    }
  }

  return prisma.conversation.create({
    data: {
      organizationId: session.organizationId,
      ownerId: session.userId,
      kind: params.productId ? "PRODUCT" : "ADVISOR",
      title,
      productId: params.productId || null,
    },
  });
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

  return conversation;
}
