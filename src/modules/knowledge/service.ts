import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { KnowledgeSourceKind } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { syncKnowledgeSource } from "./sync";
import { searchKnowledge } from "./search";
import { listCompanyFacts, upsertCompanyFact, confirmCompanyFact, supersedeCompanyFact } from "./facts";

export async function createKnowledgeSource(
  session: SessionContext,
  params: {
    name: string;
    rootPath: string;
    kind?: KnowledgeSourceKind;
    includeGlobs?: string[];
    excludeGlobs?: string[];
  }
) {
  const name = params.name?.trim();
  const rootPath = params.rootPath?.trim();
  if (!name) throw new UnprocessableEntityError("知识源名称必填");
  if (!rootPath) throw new UnprocessableEntityError("知识源目录绝对路径必填");

  return prisma.knowledgeSource.create({
    data: {
      organizationId: session.organizationId,
      name,
      rootPath,
      kind: params.kind || KnowledgeSourceKind.OBSIDIAN_VAULT,
      includeGlobs: params.includeGlobs ? (params.includeGlobs as any) : null,
      excludeGlobs: params.excludeGlobs ? (params.excludeGlobs as any) : null,
      createdById: session.userId,
    },
  });
}

export async function listKnowledgeSources(session: SessionContext) {
  return prisma.knowledgeSource.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          documents: { where: { deletedAt: null } },
          syncRuns: true,
        },
      },
      syncRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });
}

export async function getKnowledgeOverview(session: SessionContext) {
  const [sources, docCount, chunkCount, facts] = await Promise.all([
    listKnowledgeSources(session),
    prisma.knowledgeDocument.count({
      where: { organizationId: session.organizationId, deletedAt: null },
    }),
    prisma.knowledgeChunk.count({
      where: { organizationId: session.organizationId, document: { deletedAt: null } },
    }),
    listCompanyFacts(session),
  ]);

  return {
    sources,
    stats: {
      sourceCount: sources.length,
      documentCount: docCount,
      chunkCount,
      confirmedFactsCount: facts.filter((f) => f.status === "CONFIRMED").length,
      pendingFactsCount: facts.filter((f) => f.status === "PENDING").length,
    },
    facts,
  };
}

export {
  syncKnowledgeSource,
  searchKnowledge,
  listCompanyFacts,
  upsertCompanyFact,
  confirmCompanyFact,
  supersedeCompanyFact,
};
