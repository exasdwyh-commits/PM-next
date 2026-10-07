/**
 * KX-74 每周复盘：读真实数据算建议；「采纳」只做用户本来就能做的事
 * （置顶 / 忘掉自己的记忆、写一条章程、删自己的做法），所以不需要额外权限模型。
 */

import { createHash } from "node:crypto";
import { KernMemoryKind } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { UnprocessableEntityError } from "@/shared/errors";
import { forgetMemory, listMemories, rememberForUser, setMemoryPinned } from "@/modules/memory";
import { deletePlaybook, listPlaybooks, playbookMetrics } from "@/modules/playbooks/service";
import { readMissionSnapshot } from "./service";
import { buildWeeklyReview, type ReviewProposalOp, type WeeklyReview } from "./weekly-review";

export const REVIEW_WINDOW_DAYS = 7;

export async function computeWeeklyReview(session: SessionContext, opts: { until?: Date; days?: number } = {}): Promise<WeeklyReview> {
  const until = opts.until ?? new Date();
  const since = new Date(until.getTime() - (opts.days ?? REVIEW_WINDOW_DAYS) * 86_400_000);
  const rows = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      parentTaskId: null,
      createdAt: { gte: since, lte: until },
      contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" },
    },
    select: { id: true, createdAt: true, contextSnapshot: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const missions = rows
    .map((r) => ({ r, snap: readMissionSnapshot(r.contextSnapshot) }))
    .filter((x) => x.snap && !x.snap.demo)
    .map(({ r, snap }) => ({ id: r.id, goal: snap!.plan.goal, createdAt: r.createdAt, metrics: snap!.metrics ?? null, playbookRef: snap!.playbookRef ?? null }));
  const memories = (await listMemories(session)).map((m) => ({ id: m.id, kind: m.kind, content: m.content, pinned: m.pinned, topics: m.topics, useCount: m.useCount, createdAt: m.createdAt }));
  const pbs = await listPlaybooks(session);
  const playbooks = await Promise.all(pbs.map(async (p) => ({ id: p.id, name: p.name, metrics: await playbookMetrics(session, p.id) })));
  return buildWeeklyReview({ since, until, missions, memories, playbooks });
}

export function parseProposalOp(body: unknown): ReviewProposalOp {
  const b = (body ?? {}) as Record<string, unknown>;
  const op = typeof b.op === "string" ? b.op : "";
  const str = (k: string) => (typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim() : null);
  if (op === "memory.remember") {
    const content = str("content");
    if (!content || content.length > 400) throw new UnprocessableEntityError("content 必填且不超过 400 字");
    return { op, content };
  }
  if (op === "memory.pin" || op === "memory.forget") {
    const memoryId = str("memoryId");
    if (!memoryId) throw new UnprocessableEntityError("memoryId 必填");
    return { op, memoryId };
  }
  if (op === "playbook.delete") {
    const playbookId = str("playbookId");
    if (!playbookId) throw new UnprocessableEntityError("playbookId 必填");
    return { op, playbookId };
  }
  throw new UnprocessableEntityError("op 必须是 memory.remember / memory.pin / memory.forget / playbook.delete");
}

/** 采纳一条建议。返回做了什么，供 UI 回执。 */
export async function applyReviewProposal(session: SessionContext, op: ReviewProposalOp): Promise<{ applied: string }> {
  switch (op.op) {
    case "memory.remember": {
      const source = `charter:${createHash("sha1").update(op.content).digest("hex").slice(0, 16)}`;
      await rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content: op.content, pinned: true, source });
      return { applied: "已写进章程（置顶偏好）" };
    }
    case "memory.pin":
      if (!(await setMemoryPinned(session, op.memoryId, true))) throw new UnprocessableEntityError("这条记忆不存在或已忘掉");
      return { applied: "已置顶" };
    case "memory.forget":
      if (!(await forgetMemory(session, op.memoryId))) throw new UnprocessableEntityError("这条记忆不存在或已忘掉");
      return { applied: "已忘掉" };
    case "playbook.delete":
      await deletePlaybook(session, op.playbookId);
      return { applied: "已停用做法" };
    case "note":
      return { applied: "无需操作" };
  }
}
