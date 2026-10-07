import { KernMemoryKind, Prisma } from "@prisma/client";
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
