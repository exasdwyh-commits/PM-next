import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { CompanyFactStatus } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { assertCompanyFactRef, assertKnowledgeDocumentRef } from "../identity/ownership";

export async function listCompanyFacts(
  session: SessionContext,
  params?: { category?: string; status?: CompanyFactStatus }
) {
  return prisma.companyFact.findMany({
    where: {
      organizationId: session.organizationId,
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      confirmedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function upsertCompanyFact(
  session: SessionContext,
  params: {
    key: string;
    label: string;
    value: string;
    category?: string;
    sourceDocId?: string | null;
    sourcePath?: string | null;
    status?: CompanyFactStatus;
  }
) {
  const key = params.key?.trim();
  const label = params.label?.trim();
  const value = params.value?.trim();
  if (!key) throw new UnprocessableEntityError("事实唯一标识（key）必填");
  if (!label) throw new UnprocessableEntityError("事实名称（label）必填");
  if (!value) throw new UnprocessableEntityError("事实内容（value）必填");

  // B5：sourceDocId 来自请求体，不可信 —— 必须是本组织的知识文档。
  // 此前直接落库，可把其它组织的文档 id 写成本组织事实的"来源"。
  if (params.sourceDocId) {
    await assertKnowledgeDocumentRef(session, params.sourceDocId, "来源文档");
  }

  return prisma.companyFact.upsert({
    where: {
      organizationId_key: {
        organizationId: session.organizationId,
        key,
      },
    },
    create: {
      organizationId: session.organizationId,
      key,
      label,
      value,
      category: params.category?.trim() || "general",
      status: params.status || CompanyFactStatus.PENDING,
      sourceDocId: params.sourceDocId || null,
      sourcePath: params.sourcePath || null,
    },
    update: {
      label,
      value,
      category: params.category?.trim() || "general",
      sourceDocId: params.sourceDocId || null,
      sourcePath: params.sourcePath || null,
    },
  });
}

export async function confirmCompanyFact(session: SessionContext, factId: string) {
  const fact = await prisma.companyFact.findUnique({
    where: { id: factId },
  });
  if (!fact || fact.organizationId !== session.organizationId) {
    throw new NotFoundError("Company fact not found");
  }

  return prisma.companyFact.update({
    where: { id: fact.id },
    data: {
      status: CompanyFactStatus.CONFIRMED,
      confirmedById: session.userId,
      confirmedAt: new Date(),
    },
  });
}

export async function supersedeCompanyFact(
  session: SessionContext,
  factId: string,
  supersededById?: string
) {
  const fact = await prisma.companyFact.findUnique({
    where: { id: factId },
  });
  if (!fact || fact.organizationId !== session.organizationId) {
    throw new NotFoundError("Company fact not found");
  }

  // B5：supersededById 来自请求体，不可信 —— 必须是本组织的事实
  if (supersededById) {
    await assertCompanyFactRef(session, supersededById, "被替代事实");
  }

  return prisma.companyFact.update({
    where: { id: fact.id },
    data: {
      status: CompanyFactStatus.SUPERSEDED,
      supersededById: supersededById || null,
    },
  });
}
