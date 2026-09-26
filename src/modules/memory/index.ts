import { KernMemoryKind, Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { assertMemoryQuotaTx } from "@/modules/billing";

/**
 * Kern Memory
 * ===========
 * Letta/MemGPT-style split, kept deliberately small:
 *   - core memory  = pinned + PREFERENCE items, always injected
 *   - recall memory = OUTCOME/DECISION/FACT, injected when relevant to the goal
 * Everything is user-visible and forgettable. No embeddings yet: relevance is
 * CJK-bigram / word overlap, which is enough at personal scale (hundreds of items).
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
}

/** Core (pinned/preferences) first, then the most relevant recall items. */
export function selectMemories<T extends MemoryLike>(items: T[], query: string, limit = 8): T[] {
  const core = items.filter((m) => m.pinned || m.kind === KernMemoryKind.PREFERENCE).slice(0, 5);
  const coreIds = new Set(core.map((m) => m.id));
  const recall = items
    .filter((m) => !coreIds.has(m.id))
    .map((m) => ({ m, score: relevance(query, m.content) }))
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
};

export function renderMemoryPrompt(items: MemoryLike[]): string {
  if (!items.length) return "";
  return [
    "## 你记得的关于这位用户的事（长期记忆，优先遵守偏好；如与当前要求冲突，以当前要求为准）",
    ...items.map((m) => `- [${KIND_LABEL[m.kind] ?? m.kind}] ${m.content}`),
  ].join("\n");
}

// ---------------------------------------------------------------- persistence

export async function rememberForUser(
  session: Pick<SessionContext, "organizationId" | "userId">,
  input: { kind: KernMemoryKind; content: string; source?: string | null; pinned?: boolean }
) {
  const content = input.content.trim().slice(0, MAX_MEMORY_CHARS);
  if (!content) return null;
  const data = {
    organizationId: session.organizationId,
    userId: session.userId,
    kind: input.kind,
    content,
    source: input.source ?? null,
    pinned: input.pinned ?? false,
  };
  // Quota is enforced only when a *new* active row would be created; updating
  // an existing source-keyed memory (e.g. a re-synthesized mission outcome)
  // does not consume quota. The advisory lock serializes concurrent inserts
  // per organization so the limit cannot be overshot.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"kern-memory:" + session.organizationId}))`;
    if (input.source) {
      const existing = await tx.kernMemory.findUnique({
        where: { userId_source: { userId: session.userId, source: input.source } },
        select: { id: true, forgottenAt: true },
      });
      if (existing && !existing.forgottenAt) {
        return tx.kernMemory.update({
          where: { id: existing.id },
          data: { content, kind: input.kind },
        });
      }
      await assertMemoryQuotaTx(tx, session.organizationId);
      return tx.kernMemory.upsert({
        where: { userId_source: { userId: session.userId, source: input.source } },
        create: data,
        update: { content, kind: input.kind, forgottenAt: null },
      });
    }
    await assertMemoryQuotaTx(tx, session.organizationId);
    return tx.kernMemory.create({ data });
  });
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
