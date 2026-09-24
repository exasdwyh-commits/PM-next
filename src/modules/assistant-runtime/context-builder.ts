import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import type { DepartmentAssistantContext } from "./contracts";

export async function buildDepartmentAssistantContext(
  session: SessionContext,
  conversationId: string
): Promise<DepartmentAssistantContext> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      organizationId: true,
      ownerId: true,
      productId: true,
    },
  });
  if (
    !conversation ||
    conversation.organizationId !== session.organizationId ||
    conversation.ownerId !== session.userId
  ) {
    throw new NotFoundError("Conversation not found");
  }

  const [projects, facts] = await Promise.all([
    conversation.productId
      ? prisma.project.findMany({
          where: {
            organizationId: session.organizationId,
            productId: conversation.productId,
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true },
        })
      : Promise.resolve([]),
    prisma.companyFact.findMany({
      where: {
        organizationId: session.organizationId,
        status: "CONFIRMED",
      },
      orderBy: { confirmedAt: "desc" },
      take: 20,
      select: { id: true, key: true },
    }),
  ]);

  return {
    runtimeVersion: "department-assistant/v1",
    organizationId: session.organizationId,
    conversationId,
    productId: conversation.productId,
    linkedProjectIds: projects.map((project) => project.id),
    confirmedCompanyFactRefs: facts.map((fact) => `company-fact:${fact.id}:${fact.key}`),
    collaborationMode: "ASSISTANT",
    reflexMode: "SHADOW_UNCONFIGURED",
  };
}
