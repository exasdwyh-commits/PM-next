import { AgentTaskStatus, AgentRunStatus } from "@prisma/client";
import prisma from "@/shared/db";
import { executorStrategyCodes } from "./executor";
import { workerHandlers } from "./registry";

/**
 * 组织公平轮转的候选发现（TASK-011 / F2 / F3）。
 *
 * 旧行为：全局 orderBy 取前 N 条，组织 A 的旧积压会把候选窗口占满，
 * 组织 B 的队列永远排不到；多轮积压下 B 被永久饿死。
 * 新行为：先 DISTINCT 出「有候选的组织」，再按轮转游标轮流从每隔组织取，
 * 这一轮可能在 B 之前看到 A，下一轮轮到 B；组织内部仍保持优先级 / 时间顺序。
 * 游标模块级持久，跨轮询保持位置，因此 B 即使在下一轮才入队也会被命中。
 */

const ORG_PAGE_SIZE = 20;

/**
 * 服务游标：记录「上次服务到哪个组织键」，用稳定键分页而不是行偏移。
 *
 * 两轮修复暴露的同一个坑：
 *   - 固定窗口（take:20 不翻页）→ 第 21 个组织永久不可见；
 *   - 行偏移 + 各页共用一个 rotation → 每页起点按固定步长前进，
 *     小批次永远只服务同一段前缀（实测 80 个组织只有 40 个真正执行过）。
 *
 * 现在游标记的是**实际服务到的组织键**，候选读取从它的下一个键开始并回绕，
 * 因此「读到哪里」和「服务到哪里」是同一件事：每次 tick 必然向前推进，
 * 也不会因为组织增删导致偏移跳过移动的行。组织内部排序保持不变。
 */
/**
 * 两个游标，都用稳定键 `organizationId > after` 做键集过滤（不用行偏移：
 * 组织增删时偏移会跳过移动的行）。每轮最多查 ORG_PAGE_SIZE 个组织，查询量有界。
 *
 * 服务游标 `serveCursors` —— 回答「下一条该服务谁」，必须跟着**实际推进**走：
 *   · 真正领取到工作 → 记；
 *   · 因「该组织自身饱和」而明确跳过 → 记；
 *   · 因**总容量不足**而停下 → **不记**。那不是服务过，只是这一轮没排上，
 *     它必须保留下一轮的机会；每轮都记会变成固定步长跳过，小容量下一半组织永远轮不到。
 *
 * 只读游标 `readCursors` —— 回答「下一次发现从哪里看」，保证「只发现不执行」的
 * 反复调用也能扫过整个组织空间。只要服务游标已置位，发现就从服务游标继续，
 * 它不参与。
 *
 * 关键：**读完一页不等于服务完这页**。尾页（不足一页）照常返回、照常服务，
 * 等服务位置真的走到最后一个组织之后，下一次键集查询自然返回空，才回绕。
 * 早先按「本页不足 ORG_PAGE_SIZE」提前清空服务位置，会让第一个被审视的候选
 * 把位置清零，随后从只读游标继续，直接跳过尾页里尚未服务的组织。
 */
const serveCursors = new Map<string, string | null>();
const readCursors = new Map<string, string | null>();

export function resetFairQueueCursorsForTest(): void {
  serveCursors.clear();
  readCursors.clear();
}

function cursorFor(key: string): string | null {
  return serveCursors.get(key) ?? null;
}

/** 记录本轮**真正推进到的**服务位置（规则见上方注释）。 */
export function markServed(queue: "executor" | "conversation", organizationId: string): void {
  serveCursors.set(queue, organizationId);
}

/** 记录本轮**返回给调用方**的最后一个组织（按候选而非整页末尾推进）。 */
export function markRead(queue: "executor" | "conversation", organizationId: string): void {
  readCursors.set(queue, organizationId);
}

async function nextOrganizationPage<T extends { organizationId: string }>(
  fetch: (after: string | undefined) => Promise<T[]>,
  key: string
): Promise<T[]> {
  const serve = cursorFor(key);
  const readAfter = readCursors.get(key) ?? null;
  // 服务位置优先；没有服务进度时才用只读游标；再不行从头开始（回绕）。
  const starts: Array<string | null> = serve ? [serve, readAfter, null] : [readAfter, null];
  for (const start of starts) {
    const page = await fetch(start ?? undefined);
    if (page.length > 0) return page;
  }
  readCursors.set(key, null);
  serveCursors.set(key, null);
  return [];
}

function roundRobinByOrg<T>(byOrg: T[][], limit: number): T[] {
  const out: T[] = [];
  const idx = byOrg.map(() => 0);
  while (out.length < limit) {
    let progressed = false;
    for (let i = 0; i < byOrg.length && out.length < limit; i++) {
      if (idx[i] < byOrg[i].length) {
        out.push(byOrg[i][idx[i]]);
        idx[i] += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

export interface ExecutorCandidate {
  id: string;
  organizationId: string;
  agent: { code: string };
}

/** executor 候选：QUEUED + 可执行 code + 到期；按组织轮转，组织内 priority/createdAt。 */
export async function discoverExecutorCandidates(
  limit: number,
  organizationId?: string
): Promise<ExecutorCandidate[]> {
  const codes = executorStrategyCodes();
  const filter = {
    status: AgentTaskStatus.QUEUED,
    availableAt: { lte: new Date() },
    OR: [
      { agent: { code: { in: codes } } },
      ...(workerHandlers().contextSchemaVersions ?? []).map((schemaVersion) => ({
        contextSnapshot: { path: ["schemaVersion"], equals: schemaVersion },
      })),
    ],
    ...(organizationId ? { organizationId } : {}),
  };

  // 真正的候选窗口 = **分页轮转**得到的这些组织；第 21 个组织在下一页，
  // 不会被前 20 个持续积压的组织永久挡在门外。
  const groups = await nextOrganizationPage(
    (after) =>
      prisma.agentTask.groupBy({
        by: ["organizationId"],
        where: organizationId ? filter : { ...filter, ...(after ? { organizationId: { gt: after } } : {}) },
        orderBy: { organizationId: "asc" },
        take: ORG_PAGE_SIZE,
      }),
    "executor"
  );
  const orgs = groups.map((g) => g.organizationId);
  if (orgs.length === 0) return [];
  const rotated = orgs; // 页内顺序即服务顺序，不再有与页数耦合的旋转

  const perOrg = Math.max(1, Math.ceil(limit / Math.max(1, rotated.length)) + 1);
  const lists = await Promise.all(
    rotated.map((org) =>
      prisma.agentTask.findMany({
        where: { ...filter, organizationId: org },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        select: { id: true, organizationId: true, agent: { select: { code: true } } },
        take: perOrg,
      })
    )
  );
  const out = roundRobinByOrg(lists, limit);
  if (out.length > 0) markRead("executor", out[out.length - 1].organizationId);
  return out;
}

export interface MessageCandidate {
  id: string;
  organizationId: string;
}

/** 会话消息候选：QUEUED + 有 clientMessageId；按组织轮转，组织内 createdAt/id。 */
export async function discoverMessageCandidates(
  limit: number,
  organizationId?: string
): Promise<MessageCandidate[]> {
  const filter = {
    status: AgentRunStatus.QUEUED,
    clientMessageId: { not: null },
    ...(organizationId ? { organizationId } : {}),
  };
  const groups = await nextOrganizationPage(
    (after) =>
      prisma.agentRun.groupBy({
        by: ["organizationId"],
        where: organizationId ? filter : { ...filter, ...(after ? { organizationId: { gt: after } } : {}) },
        orderBy: { organizationId: "asc" },
        take: ORG_PAGE_SIZE,
      }),
    "conversation"
  );
  const orgs = groups.map((g) => g.organizationId);
  if (orgs.length === 0) return [];
  const rotated = orgs;

  const perOrg = Math.max(1, Math.ceil(limit / Math.max(1, rotated.length)) + 1);
  const lists = await Promise.all(
    rotated.map((org) =>
      prisma.agentRun.findMany({
        where: { ...filter, organizationId: org },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, organizationId: true },
        take: perOrg,
      })
    )
  );
  const out = roundRobinByOrg(lists, limit);
  if (out.length > 0) markRead("conversation", out[out.length - 1].organizationId);
  return out;
}
