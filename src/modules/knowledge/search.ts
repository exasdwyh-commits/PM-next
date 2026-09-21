import prisma from "@/shared/db";
import { SessionContext } from "../identity/session";
import { CompanyFactStatus } from "@prisma/client";

export interface KnowledgeCitation {
  kind: "knowledge";
  ref: string; // chunkId
  docId: string;
  docTitle: string;
  relativePath: string;
  headingPath: string | null;
  snippet: string;
  score: number;
}

export interface MatchedCompanyFact {
  id: string;
  key: string;
  label: string;
  value: string;
  category: string;
  status: CompanyFactStatus;
}

export interface KnowledgeSearchResult {
  query: string;
  citations: KnowledgeCitation[];
  facts: MatchedCompanyFact[];
}

const STOP_WORDS = new Set([
  "公司", "我们", "请问", "请教", "咨询", "关于", "一下", "有没有", "有什么", "是什么", "哪些",
  "怎么", "如何", "这个", "那个", "什么", "目前", "现在", "是否有"
]);

function extractKeywords(query: string): string[] {
  const cleaned = query.replace(/[?？!！,，。;；:：\[\]\(\)\{\}"'“”‘’]/g, " ").trim();
  const rawTerms = cleaned.split(/\s+/).filter(Boolean);
  const terms: Set<string> = new Set();

  for (const t of rawTerms) {
    if (t.length >= 2 && !STOP_WORDS.has(t)) terms.add(t.toLowerCase());
    // For Chinese strings longer than 3 characters, also add 2-gram subterms
    if (/[\u4e00-\u9fa5]/.test(t) && t.length >= 4) {
      for (let i = 0; i <= t.length - 2; i += 2) {
        const sub = t.slice(i, i + 2);
        if (!STOP_WORDS.has(sub)) {
          terms.add(sub);
        }
      }
    }
  }

  return Array.from(terms);
}

function generateSnippet(content: string, keywords: string[], maxLen: number = 140): string {
  if (!content) return "";
  let bestPos = -1;
  const lowerContent = content.toLowerCase();

  for (const kw of keywords) {
    const pos = lowerContent.indexOf(kw.toLowerCase());
    if (pos !== -1) {
      bestPos = pos;
      break;
    }
  }

  if (bestPos === -1) {
    return content.slice(0, maxLen).trim() + (content.length > maxLen ? "..." : "");
  }

  const start = Math.max(0, bestPos - 30);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end).trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";
  return snippet;
}

export async function searchKnowledge(
  session: SessionContext,
  params: { query: string; limit?: number }
): Promise<KnowledgeSearchResult> {
  const query = params.query?.trim() || "";
  const limit = params.limit || 8;
  if (!query) {
    return { query, citations: [], facts: [] };
  }

  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return { query, citations: [], facts: [] };
  }

  // 1. Search Company Facts (confirmed first, then pending)
  const facts = await prisma.companyFact.findMany({
    where: {
      organizationId: session.organizationId,
      status: { in: [CompanyFactStatus.CONFIRMED, CompanyFactStatus.PENDING] },
      OR: keywords.flatMap((kw) => [
        { label: { contains: kw, mode: "insensitive" as const } },
        { value: { contains: kw, mode: "insensitive" as const } },
        { key: { contains: kw, mode: "insensitive" as const } },
      ]),
    },
    take: 5,
    orderBy: { status: "asc" }, // CONFIRMED first
  });

  // 2. Search Knowledge Chunks (restricted strictly to organizationId and non-deleted documents)
  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      organizationId: session.organizationId,
      document: { deletedAt: null },
      OR: keywords.flatMap((kw) => [
        { content: { contains: kw, mode: "insensitive" as const } },
        { headingPath: { contains: kw, mode: "insensitive" as const } },
        { document: { title: { contains: kw, mode: "insensitive" as const } } },
      ]),
    },
    include: {
      document: {
        select: { id: true, title: true, relativePath: true },
      },
    },
    take: 40,
  });

  // Rank and score chunks
  const scoredChunks: KnowledgeCitation[] = [];
  for (const chunk of chunks) {
    let score = 0;
    const lowerTitle = chunk.document.title.toLowerCase();
    const lowerHeading = (chunk.headingPath || "").toLowerCase();
    const lowerContent = chunk.content.toLowerCase();

    for (const kw of keywords) {
      if (lowerTitle.includes(kw)) score += 10;
      if (lowerHeading.includes(kw)) score += 6;
      const count = lowerContent.split(kw).length - 1;
      score += Math.min(count * 2, 8);
    }

    scoredChunks.push({
      kind: "knowledge",
      ref: chunk.id,
      docId: chunk.document.id,
      docTitle: chunk.document.title,
      relativePath: chunk.document.relativePath,
      headingPath: chunk.headingPath,
      snippet: generateSnippet(chunk.content, keywords),
      score,
    });
  }

  scoredChunks.sort((a, b) => b.score - a.score);

  return {
    query,
    citations: scoredChunks.slice(0, limit),
    facts: facts.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      value: f.value,
      category: f.category,
      status: f.status,
    })),
  };
}
