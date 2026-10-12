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
  /** 文档最后更新时间。切片（Chunk）自身没有时间字段，取所属文档的。 */
  docUpdatedAt: string | null;
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

/**
 * 单关键词候选上限：宽泛词（「配方」「测试」）最多交这么多条。
 * 60 足够覆盖中等精确词的命中量，又不会让一个词把候选池吃满。
 */
const PER_KEYWORD_CANDIDATES = 60;

/** 关键词数量上限，防止超长查询把候选池与 SQL 次数放大。 */
const MAX_KEYWORDS = 24;

/**
 * 逐关键词取候选后合并去重 —— 而不是把整条 OR 一次性 `take: N`。
 *
 * 为什么必须这么做（2026-10-12 实测定位）：
 * 旧实现是
 *   `findMany({ where: { OR: [全部关键词的 contains] }, take: 40 })`
 * 一旦查询里混入「配方 / 测试 / 效果」这类宽泛词，全库匹配会冲到 1300+ 条，
 * 而 **SQL 层 `take(40)` 不带 `orderBy`，取回的是任意 40 条**：
 * 精确词（如「恒天」）那十来条命中大概率被挤出候选池，
 * 后面打分排得再准也救不回来 —— 表现为「库里明明有，检索却说没命中」。
 *
 * 逐词取候选后，宽泛词被自身配额摊薄，精确词则把它**全部**命中交进来，
 * 候选池因此不再由「谁先被 SQL 返回」决定。纯函数，便于脱库单测。
 */
export async function collectCandidates<T extends { id: string }>(
  keywords: string[],
  fetchByKeyword: (keyword: string) => Promise<T[]>
): Promise<T[]> {
  const merged = new Map<string, T>();
  for (const keyword of keywords) {
    const rows = await fetchByKeyword(keyword);
    for (const row of rows) {
      if (!merged.has(row.id)) merged.set(row.id, row);
    }
  }
  return Array.from(merged.values());
}

export interface KnowledgeSearchParams {
  query: string;
  limit?: number;
  /**
   * 只检索这些知识源；缺省 = 全部**已启用**的源。
   * 「指定文件夹」的唯一入口 —— 同步侧靠 `KnowledgeSource.rootPath` 决定灌什么，
   * 检索侧靠这个参数决定取什么；两者缺一，指定就只是句空话。
   */
  sourceIds?: string[];
}

export async function searchKnowledge(
  session: SessionContext,
  params: KnowledgeSearchParams,
  /** C5-A1：路由透传的取消信号。Prisma 查询本身不支持 signal，做法是：关键步骤之间
   *  检查 aborted（慢查询的下一阶段不再发），调用方（router）另有竞速兜底保证不 hang。 */
  signal?: AbortSignal
): Promise<KnowledgeSearchResult> {
  const query = params.query?.trim() || "";
  const limit = params.limit || 8;
  if (!query) {
    return { query, citations: [], facts: [] };
  }

  const keywords = extractKeywords(query).slice(0, MAX_KEYWORDS);
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

  // 2. Search Knowledge Chunks (restricted strictly to organizationId, enabled sources and non-deleted documents)
  //    逐关键词取候选：见 collectCandidates 的注释（旧的一次性 take(40) 会让精确词命中被挤出）。
  //    C5-A1：facts 查完后先检查取消 —— 在途的下一阶段查询不再发出。
  signal?.throwIfAborted();
  const sourceFilter = params.sourceIds?.length
    ? { enabled: true, id: { in: params.sourceIds } }
    : { enabled: true };
  const chunks = await collectCandidates(keywords, (kw) =>
    prisma.knowledgeChunk.findMany({
      where: {
        organizationId: session.organizationId,
        // `enabled` 是「这个源现在用不用」的总闸。此前它只有 auto-sync 一个消费点，
        // 检索完全无视 ⇒ 停用的源照样全量出在回执里，「指定文件夹」因此从来没生效过。
        document: { deletedAt: null, source: sourceFilter },
        OR: [
          { content: { contains: kw, mode: "insensitive" as const } },
          { headingPath: { contains: kw, mode: "insensitive" as const } },
          { document: { title: { contains: kw, mode: "insensitive" as const } } },
        ],
      },
      select: {
        id: true,
        content: true,
        headingPath: true,
        document: {
          select: { id: true, title: true, relativePath: true, updatedAt: true },
        },
      },
      take: PER_KEYWORD_CANDIDATES,
    })
  );

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
      docUpdatedAt: chunk.document.updatedAt?.toISOString() ?? null,
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
