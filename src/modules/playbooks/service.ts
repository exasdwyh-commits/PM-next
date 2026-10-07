import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import type { MissionMetrics, MissionPlan, PlaybookMetrics } from "@/modules/kern-contracts";
import { aggregatePlaybookMetrics } from "@/modules/supervisor/metrics";
import { goalCore, pickPlaybook, templatizePlan } from "./match";

/**
 * KX-36 · 把成功链路沉淀为可复用的做法
 * ====================================
 * - 只有**顺利完成**、且不是演示的工作才能保存；保存的是**最终**计划（含用户的调整和跳过）。
 * - 以后发起相近的目标时，简报自动套用这个做法，并明确告诉用户“按你保存的做法「X」”，可以一键不用。
 * - 每次按做法启动计一次使用，结束时按结果计成功 / 未成功，匹配时成功率高的优先。
 * 做法只属于本人（与记忆同一作用域）。
 */

export const MAX_PLAYBOOKS_PER_USER = 50;
type Row = Awaited<ReturnType<typeof prisma.kernPlaybook.findFirstOrThrow>>;

const view = (p: Row) => ({
  id: p.id,
  name: p.name,
  sourceGoal: p.sourceGoal,
  steps: Array.isArray((p.plan as { nodes?: unknown[] })?.nodes) ? (p.plan as { nodes: unknown[] }).nodes.length : 0,
  useCount: p.useCount,
  successCount: p.successCount,
  failureCount: p.failureCount,
  /** KX-73：连续验收通过次数。 */
  acceptedStreak: p.acceptedStreak,
  lastAcceptedAt: p.lastAcceptedAt?.toISOString() ?? null,
  lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});
export type PlaybookView = ReturnType<typeof view>;

function cleanName(name: unknown, fallback: string): string {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  return n || fallback.slice(0, 40);
}

export async function savePlaybookFromMission(session: SessionContext, missionTaskId: string, name?: unknown): Promise<{ item: PlaybookView; created: boolean }> {
  const { readMissionSnapshot } = await import("@/modules/supervisor/service");
  const task = await prisma.agentTask.findFirst({
    where: { id: missionTaskId, organizationId: session.organizationId, createdByUserId: session.userId },
    select: { contextSnapshot: true },
  });
  const snap = task ? readMissionSnapshot(task.contextSnapshot) : null;
  if (!snap) throw new NotFoundError("Mission not found");
  if (snap.demo) throw new UnprocessableEntityError("演示运行不能保存为做法");
  if (snap.outcome?.status !== "COMPLETED") throw new UnprocessableEntityError("只有顺利完成的工作才能保存为做法");
  const core = goalCore(snap.plan.goal);
  const existing = await prisma.kernPlaybook.findUnique({ where: { userId_sourceMissionTaskId: { userId: session.userId, sourceMissionTaskId: missionTaskId } } });
  if (existing) {
    const item = typeof name === "string" && name.trim()
      ? await prisma.kernPlaybook.update({ where: { id: existing.id }, data: { name: cleanName(name, existing.name) } })
      : existing;
    return { item: view(item), created: false };
  }
  const count = await prisma.kernPlaybook.count({ where: { organizationId: session.organizationId, userId: session.userId } });
  if (count >= MAX_PLAYBOOKS_PER_USER) throw new UnprocessableEntityError(`最多保存 ${MAX_PLAYBOOKS_PER_USER} 个做法，可以先删掉不用的`);
  const item = await prisma.kernPlaybook.create({
    data: {
      organizationId: session.organizationId,
      userId: session.userId,
      name: cleanName(name, core),
      sourceGoal: core.slice(0, 500),
      sourceMissionTaskId: missionTaskId,
      plan: JSON.parse(JSON.stringify(templatizePlan(snap.plan))),
    },
  });
  return { item: view(item), created: true };
}

export async function listPlaybooks(session: SessionContext): Promise<PlaybookView[]> {
  const rows = await prisma.kernPlaybook.findMany({ where: { organizationId: session.organizationId, userId: session.userId }, orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] });
  return rows.map(view);
}

async function own(session: SessionContext, id: string) {
  const row = await prisma.kernPlaybook.findFirst({ where: { id, organizationId: session.organizationId, userId: session.userId } });
  if (!row) throw new NotFoundError("Playbook not found");
  return row;
}

export async function renamePlaybook(session: SessionContext, id: string, name: unknown): Promise<PlaybookView> {
  const row = await own(session, id);
  if (typeof name !== "string" || !name.trim()) throw new UnprocessableEntityError("需要新的名称");
  return view(await prisma.kernPlaybook.update({ where: { id: row.id }, data: { name: cleanName(name, row.name) } }));
}

export async function deletePlaybook(session: SessionContext, id: string): Promise<void> {
  const row = await own(session, id);
  await prisma.kernPlaybook.delete({ where: { id: row.id } });
}

/** 为新目标找最相近的做法（仅本人）。 */
export async function findPlaybookForGoal(session: SessionContext, goal: string): Promise<{ id: string; name: string; score: number; useCount: number; successCount: number; template: MissionPlan } | null> {
  const rows = await prisma.kernPlaybook.findMany({
    where: { organizationId: session.organizationId, userId: session.userId },
    select: { id: true, name: true, sourceGoal: true, plan: true, useCount: true, successCount: true, failureCount: true },
    take: MAX_PLAYBOOKS_PER_USER,
  });
  const hit = pickPlaybook(goal, rows.map((r) => ({ ...r, matchText: `${r.name} ${r.sourceGoal}` })));
  if (!hit) return null;
  const p = hit.playbook;
  return { id: p.id, name: p.name, score: hit.score, useCount: p.useCount, successCount: p.successCount, template: p.plan as unknown as MissionPlan };
}

export async function markPlaybookUsed(id: string): Promise<void> {
  await prisma.kernPlaybook.updateMany({ where: { id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
}

export async function recordPlaybookOutcome(id: string, completed: boolean): Promise<void> {
  // KX-73：没完成就清零「连续验收通过」。
  await prisma.kernPlaybook.updateMany({ where: { id }, data: completed ? { successCount: { increment: 1 } } : { failureCount: { increment: 1 }, acceptedStreak: 0 } });
}

/** KX-73：一次复核通过 → 连续次数 +1。 */
export async function recordPlaybookAcceptance(id: string): Promise<void> {
  await prisma.kernPlaybook.updateMany({ where: { id }, data: { acceptedStreak: { increment: 1 }, lastAcceptedAt: new Date() } });
}

/** KX-73：做法维度的结果指标（只统计非演示任务的已保存指标）。 */
export async function playbookMetrics(session: SessionContext, id: string): Promise<PlaybookMetrics> {
  const row = await own(session, id);
  const tasks = await prisma.agentTask.findMany({
    where: { organizationId: session.organizationId, parentTaskId: null, contextSnapshot: { path: ["playbookRef", "id"], equals: id } },
    select: { contextSnapshot: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const runs: MissionMetrics[] = [];
  for (const t of tasks) {
    const snap = t.contextSnapshot as { demo?: boolean; metrics?: MissionMetrics } | null;
    if (!snap || snap.demo || !snap.metrics) continue;
    runs.push(snap.metrics);
  }
  return aggregatePlaybookMetrics(runs, row.acceptedStreak);
}
