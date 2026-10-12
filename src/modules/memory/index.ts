import { KernMemoryKind, Prisma } from "@prisma/client";

/** Inspector 等 app 层可直接引用的记忆类型白名单（避免 app 层直接 import @prisma/client，架构层 AL3）。*/
export const MEMORY_KINDS: string[] = Object.values(KernMemoryKind) as string[];

import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { assertMemoryLimitTx } from "@/modules/usage";
import { withKeyLock } from "@/shared/key-mutex";

/**
 * Kern Memory
 * ===========
 * Letta/MemGPT-style split, kept deliberately small:
 *   - core memory  = pinned + PREFERENCE items, always injected
 *   - recall memory = OUTCOME/DECISION/FACT, injected when relevant to the goal
 * Everything is user-visible and forgettable. No embeddings yet: relevance is
 * CJK-bigram / word overlap, which is enough at personal scale (hundreds of items).
 *
 * KX-74 (memory v2):
 *   - procedural memory = CORRECTION (review notes / "not like that") — always
 *     injected, newest first, so the same mistake is not repeated;
 *   - episodic memory  = OUTCOME per mission, now tagged with `topics` so a
 *     new goal on the same topic recalls it even when the wording differs.
 */

export const MAX_MEMORY_CHARS = 400;

// ---------------------------------------------------------------- pure parts

const REMEMBER_RE = /^\s*(?:请)?(?:帮我)?(?:记住|记一下|记下|以后|今后|下次)[:：,，\s]*(.+)$/s;

/** “记住：我们只做跨境” → PREFERENCE. Returns null for anything else. */
export function extractExplicitMemory(text: string): { kind: KernMemoryKind; content: string } | null {
  const m = REMEMBER_RE.exec(text.trim());
  if (!m) return null;
  const content = m[1].trim().replace(/[。.!！]+$/, "");
  if (content.length < 2 || content.length > MAX_MEMORY_CHARS) return null;
  return { kind: KernMemoryKind.PREFERENCE, content };
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const w of lower.match(/[a-z0-9]{3,}/g) ?? []) out.add(w);
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
  return out;
}

const TOPIC_STOP = new Set(["我想","我们","一个","一下","帮我","请帮","这个","那个","以及","还有","进行","关于","如何","怎么","什么","可以","需要","是否","为了","通过","对于","方案","任务","工作","问题","分析","一份","一次","报告"]);

/**
 * Topic tags for retrieval: latin words (>=3) plus CJK runs split into 2–4 char
 * sliding bigrams, stop-words removed, capped. Deterministic, no model call.
 */
export function extractTopics(text: string, limit = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => { if (t && !seen.has(t) && !TOPIC_STOP.has(t)) { seen.add(t); out.push(t); } };
  const lower = text.toLowerCase();
  for (const w of lower.match(/[a-z][a-z0-9]{2,}/g) ?? []) push(w);
  for (const run of lower.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (run.length <= 4) push(run);
    // 滑动二元组：不依赖分词，「宠物饮水机」和「饮水机选型」都能对上「饮水」
    if (run.length >= 3) for (let i = 0; i + 2 <= run.length; i++) push(run.slice(i, i + 2));
  }
  return out.slice(0, limit);
}

export function topicOverlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let hit = 0;
  for (const t of a) if (set.has(t)) hit++;
  return hit / a.length;
}

export function relevance(query: string, content: string): number {
  const q = tokens(query);
  if (!q.size) return 0;
  const c = tokens(content);
  let hit = 0;
  for (const t of q) if (c.has(t)) hit++;
  return hit / q.size;
}

// ---------------------------------------------------------------- dedupe（C7 第一阶段）

/**
 * source=null 记忆的语义去重阈值（token Jaccard，见 memorySimilarity）。
 * 取 0.85 的依据：token 集是 CJK bigram + 英文词，bigram 对单字改动敏感
 * （改一个字约动 2 个 bigram），0.85 约等于「至多 1/7 的 token 不同」——
 * 标点/语气差异与轻微复述能过，增删一个约束、一字之差的反义过不了。
 * 再叠加数字守卫（见 sameNumbers）：数字多重集不一致一律不判重。宁漏勿
 * 误杀：漏判只是多一条，误杀会把用户的新决定原地覆盖掉。
 */
export const MEMORY_DUPE_THRESHOLD = 0.85;

/** 内容归一化：小写、合并空白、去结尾标点。与 extractExplicitMemory 的清洗口径一致。 */
export function normalizeMemoryContent(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[。.!！?？；;，,、]+$/, "");
}

function numericMultiset(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

/** 数字必须逐个对齐：金额、数量、日期不同就是另一条事实，不是重复。 */
function sameNumbers(a: string, b: string): boolean {
  const x = numericMultiset(a);
  const y = numericMultiset(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** 两条记忆内容的相似度（0–1）：归一化后完全一致为 1，否则取 tokens() 的 Jaccard。 */
export function memorySimilarity(a: string, b: string): number {
  const na = normalizeMemoryContent(a);
  const nb = normalizeMemoryContent(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / (ta.size + tb.size - hit);
}

/**
 * 在候选里找与 content 重复的一条：必须同 kind、数字一致、相似度过阈值；
 * 多条命中取相似度最高者，并列取最新。找不到返回 null（照常新建）。
 *
 * C7 第二阶段 · forget 守卫：已遗忘（forgottenAt 非空）的候选**永远不算
 * 命中**。生产路径上 rememberForUser 的候选查询已带 `forgottenAt: null`
 * 过滤，这里在纯函数里再守一道，让「删除后不被去重逻辑当作现存命中」
 * 这条不变量落在去重逻辑本身，而不是只靠某一个调用方的查询条件——
 * 否则将来任何不过滤的调用方都会把用户明确忘掉的内容原地改写复活。
 * 候选类型里 forgottenAt 是可选字段：不带该字段的候选（旧调用方）行为不变。
 */
export function findDuplicateMemory<
  T extends { kind: KernMemoryKind | string; content: string; createdAt: Date; forgottenAt?: Date | null },
>(
  candidates: readonly T[],
  kind: KernMemoryKind | string,
  content: string
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (c.forgottenAt) continue;
    if (String(c.kind) !== String(kind)) continue;
    if (!sameNumbers(content, c.content)) continue;
    const score = memorySimilarity(content, c.content);
    if (score < MEMORY_DUPE_THRESHOLD) continue;
    if (!best || score > bestScore || (score === bestScore && c.createdAt > best.createdAt)) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export interface MemoryLike {
  id: string;
  kind: KernMemoryKind | string;
  content: string;
  pinned: boolean;
  createdAt: Date;
  topics?: string[];
}

/** 每次最多带几条纠正（最新优先），避免旧意见淹没提示词。 */
export const MAX_CORRECTIONS_INJECTED = 3;

/** Core (pinned/preferences) first, then the newest corrections, then the most relevant recall items (text + topic). */
export function selectMemories<T extends MemoryLike>(items: T[], query: string, limit = 8): T[] {
  const prefs = items.filter((m) => m.pinned || m.kind === KernMemoryKind.PREFERENCE).slice(0, 5);
  const qTopics = extractTopics(query);
  const corrections = items
    .filter((m) => m.kind === KernMemoryKind.CORRECTION && !m.pinned)
    .map((m) => ({ m, score: topicOverlap(qTopics, m.topics ?? []) }))
    .sort((a, b) => b.score - a.score || b.m.createdAt.getTime() - a.m.createdAt.getTime())
    .slice(0, MAX_CORRECTIONS_INJECTED)
    .map((x) => x.m);
  const core = [...prefs, ...corrections];
  const coreIds = new Set(core.map((m) => m.id));
  const recall = items
    .filter((m) => !coreIds.has(m.id) && m.kind !== KernMemoryKind.CORRECTION)
    .map((m) => ({ m, score: relevance(query, m.content) + 0.5 * topicOverlap(qTopics, m.topics ?? []) }))
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score || b.m.createdAt.getTime() - a.m.createdAt.getTime())
    .slice(0, Math.max(0, limit - core.length))
    .map((x) => x.m);
  return [...core, ...recall];
}

const KIND_LABEL: Record<string, string> = {
  PREFERENCE: "偏好",
  FACT: "事实",
  DECISION: "决定",
  OUTCOME: "过往结论",
  CORRECTION: "纠正",
};

export function renderMemoryPrompt(items: MemoryLike[]): string {
  if (!items.length) return "";
  return [
    "## 你记得的关于这位用户的事（长期记忆，优先遵守偏好；如与当前要求冲突，以当前要求为准）",
    ...items.map((m) => `- [${KIND_LABEL[m.kind] ?? m.kind}] ${m.content}`),
  ].join("\n");
}

// ---------------------------------------------------------------- persistence

/**
 * Waiting for the cross-process advisory lock is normal and can take a moment,
 * so let a queued writer wait instead of failing to start (P2028).
 */
const MEMORY_WRITE_TX = { maxWait: 15_000, timeout: 20_000 } as const;

export async function rememberForUser(
  session: Pick<SessionContext, "organizationId" | "userId">,
  input: { kind: KernMemoryKind; content: string; source?: string | null; pinned?: boolean; topics?: string[] }
) {
  const content = input.content.trim().slice(0, MAX_MEMORY_CHARS);
  if (!content) return null;
  const topics = input.topics?.length ? input.topics.slice(0, 8) : extractTopics(content);
  const data = {
    organizationId: session.organizationId,
    userId: session.userId,
    kind: input.kind,
    content,
    source: input.source ?? null,
    pinned: input.pinned ?? false,
    topics,
  };
  // Quota is enforced only when a *new* active row would be created; updating
  // an existing source-keyed memory (e.g. a re-synthesized mission outcome)
  // does not consume quota.
  //
  // Serialization is deliberately two-layered:
  //   - withKeyLock queues this organization's writers inside this process, so
  //     a burst of "记住" cannot park N transactions on N pooled connections
  //     while they all block on the same advisory lock;
  //   - pg_advisory_xact_lock serializes across processes (web + worker), which
  //     is what actually guarantees the limit cannot be overshot.
  return withKeyLock(`kern-memory:${session.organizationId}`, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"kern-memory:" + session.organizationId}))`;
      if (input.source) {
        const existing = await tx.kernMemory.findUnique({
          where: { userId_source: { userId: session.userId, source: input.source } },
          select: { id: true, forgottenAt: true },
        });
        if (existing && !existing.forgottenAt) {
          return tx.kernMemory.update({
            where: { id: existing.id },
            data: { content, kind: input.kind, topics },
          });
        }
        await assertMemoryLimitTx(tx, session.organizationId);
        return tx.kernMemory.upsert({
          where: { userId_source: { userId: session.userId, source: input.source } },
          create: data,
          update: { content, kind: input.kind, forgottenAt: null, topics },
        });
      }
      // C7 第一阶段 · 语义去重：source=null 没有唯一键兜底（多来自用户
      // 「记住…」），同一句话说两遍原本会产生两行。新建前先在同 kind 的
      // active 记忆里找高度相似的一条，命中就原地更新——与 source-keyed
      // 更新同语义，同样不占新增额度；未命中才走额度检查 + 新建。
      const candidates = await tx.kernMemory.findMany({
        where: {
          organizationId: session.organizationId,
          userId: session.userId,
          source: null,
          kind: input.kind,
          forgottenAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const dupe = findDuplicateMemory(candidates, input.kind, content);
      if (dupe) {
        return tx.kernMemory.update({
          where: { id: dupe.id },
          data: { content, topics },
        });
      }
      await assertMemoryLimitTx(tx, session.organizationId);
      return tx.kernMemory.create({ data });
    }, MEMORY_WRITE_TX)
  );
}

export async function listMemories(session: Pick<SessionContext, "organizationId" | "userId">, take = 200) {
  return prisma.kernMemory.findMany({
    where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take,
  });
}

// ---------------------------------------------------------------- provenance（C7 第一阶段 · Inspector 数据层）

/**
 * 一条记忆的来源与状态。字段与 prisma schema 的 KernMemory model 一一
 * 对应，不多不少；另加两个由真实字段派生的标记（sourceKeyed、
 * editedInPlace、forgotten），不引入 schema 之外的信息。
 *
 * 结构缺口（如实说明，本阶段不改 schema）：schema 没有「覆盖链」——
 * 没有 supersedes / supersededBy 字段，也没有版本历史表。source-keyed
 * 更新与上面的语义去重都是**同行原地改写**（同一 id、updatedAt 变化），
 * 被覆盖的旧内容不留痕，因此 provenance 无法回答「被哪条覆盖 / 覆盖了
 * 哪条内容」，只能以 editedInPlace 说明这行被改过。要补覆盖链需加字段
 * 或历史表，属下一阶段的 schema 议题。
 */
export interface MemoryProvenance {
  id: string;
  organizationId: string;
  userId: string;
  kind: KernMemoryKind;
  content: string;
  /** 写入来源标识；用户直接「记住…」的为 null。 */
  source: string | null;
  /** 是否 source-keyed（source 非空，靠 [userId, source] 唯一键原地更新）。 */
  sourceKeyed: boolean;
  pinned: boolean;
  topics: string[];
  useCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** updatedAt 晚于 createdAt = 这行被原地更新过（覆盖发生在行内，无版本留痕）。 */
  editedInPlace: boolean;
  forgottenAt: Date | null;
  forgotten: boolean;
}

/** 纯函数：把一行 KernMemory 整成 provenance（便于单测与 UI/API 共用）。 */
export function toMemoryProvenance(row: {
  id: string;
  organizationId: string;
  userId: string;
  kind: KernMemoryKind;
  content: string;
  source: string | null;
  pinned: boolean;
  topics: string[];
  useCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  forgottenAt: Date | null;
}): MemoryProvenance {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    kind: row.kind,
    content: row.content,
    source: row.source,
    sourceKeyed: row.source !== null,
    pinned: row.pinned,
    topics: row.topics,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    editedInPlace: row.updatedAt.getTime() > row.createdAt.getTime(),
    forgottenAt: row.forgottenAt,
    forgotten: row.forgottenAt !== null,
  };
}

/**
 * 按 id 查一条记忆的 provenance（给 Inspector UI / API 调用）。
 * 按组织 + 用户隔离；已遗忘的也返回（带 forgotten 标记），因为「这条
 * 为什么不在了」正是 inspector 要回答的问题。查不到或不属于该用户返回 null。
 */
export async function getMemoryProvenance(
  session: Pick<SessionContext, "organizationId" | "userId">,
  id: string
): Promise<MemoryProvenance | null> {
  const row = await prisma.kernMemory.findFirst({
    where: { id, organizationId: session.organizationId, userId: session.userId },
  });
  return row ? toMemoryProvenance(row) : null;
}

/**
 * 列出当前用户的记忆 provenance（Inspector API 用）。与 listMemories 的
 * 区别：默认**包含已遗忘条目**（带 forgotten 标记）——inspector 的职责
 * 正是回答「Kern 记得什么、哪些已经被忘掉」，只列 active 的话已遗忘项
 * 就成了不可见的黑箱。按组织 + 用户隔离，可按 kind 过滤；排序与
 * listMemories 一致（置顶优先、最新优先）。只读，不写任何行。
 */
export async function listMemoryProvenance(
  session: Pick<SessionContext, "organizationId" | "userId">,
  opts: { kind?: KernMemoryKind | string; includeForgotten?: boolean; take?: number } = {}
): Promise<MemoryProvenance[]> {
  const rows = await prisma.kernMemory.findMany({
    where: {
      organizationId: session.organizationId,
      userId: session.userId,
      ...(opts.kind ? { kind: opts.kind as KernMemoryKind } : {}),
      ...(opts.includeForgotten === false ? { forgottenAt: null } : {}),
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 200,
  });
  return rows.map(toMemoryProvenance);
}

export async function forgetMemory(session: Pick<SessionContext, "organizationId" | "userId">, id: string) {
  const r = await prisma.kernMemory.updateMany({
    where: { id, organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
    data: { forgottenAt: new Date() },
  });
  return r.count > 0;
}

export async function setMemoryPinned(session: Pick<SessionContext, "organizationId" | "userId">, id: string, pinned: boolean) {
  const r = await prisma.kernMemory.updateMany({
    where: { id, organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
    data: { pinned },
  });
  return r.count > 0;
}

/** Select + render memory for a goal, and record usage (for later pruning). */
export async function recallForPrompt(
  session: Pick<SessionContext, "organizationId" | "userId">,
  query: string,
  limit = 8
): Promise<string> {
  const all = await listMemories(session);
  const chosen = selectMemories(all, query, limit);
  if (chosen.length) {
    await prisma.kernMemory
      .updateMany({
        where: { id: { in: chosen.map((m) => m.id) } },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }
  return renderMemoryPrompt(chosen);
}

export function isMemoryTableMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}
