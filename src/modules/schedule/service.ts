import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import { launchKernMission, readMissionSnapshot, toJson } from "@/modules/supervisor/service";
import type { MissionPlan } from "@/modules/kern-contracts";
import { automationEligibility } from "@/modules/supervisor/metrics";
import { loadAttentionForUser } from "@/modules/muse/read-model";
import { describeCron, isValidTimezone, nextCronRun, parseCron } from "./cron";
import { composeDailyDigest } from "./digest";

/**
 * KX-34 · 定时与主动
 * ==================
 * 三种定时：DAILY_BRIEF（有真实内容才发的每日简报）、REMINDER（到点提醒）、
 * MISSION（按原计划重跑一项工作）。worker 的 schedule loop 负责触发：
 * 用 `updateMany where nextRunAt = 旧值` 原子认领，多 worker / 重启也不会重复触发；
 * MISSION 再用 sourceRunId = schedule:<id>:<slot> 做第二道幂等。
 */

export const SCHEDULE_KINDS = ["DAILY_BRIEF", "REMINDER", "MISSION"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export const MAX_SCHEDULES_PER_USER = 20;

const view = (s: Prisma.KernScheduleGetPayload<object>) => ({
  id: s.id,
  kind: s.kind as ScheduleKind,
  title: s.title,
  cron: s.cron,
  cronText: describeCron(s.cron),
  timezone: s.timezone,
  conversationId: s.conversationId,
  enabled: s.enabled,
  nextRunAt: s.nextRunAt?.toISOString() ?? null,
  lastRunAt: s.lastRunAt?.toISOString() ?? null,
  lastStatus: s.lastStatus,
  lastError: s.lastError,
  runCount: s.runCount,
});
export type ScheduleView = ReturnType<typeof view>;

function validateCron(cron: string, tz: string): Date {
  if (!isValidTimezone(tz)) throw new UnprocessableEntityError(`未知时区：${tz}`);
  try {
    parseCron(cron);
  } catch (e) {
    throw new UnprocessableEntityError(`定时表达式无效：${e instanceof Error ? e.message : e}`);
  }
  const next = nextCronRun(cron, new Date(), tz);
  if (!next) throw new UnprocessableEntityError("这个定时表达式永远不会触发");
  return next;
}

export type CreateScheduleInput = {
  kind: ScheduleKind;
  cron: string;
  timezone?: string;
  title?: string;
  text?: string;
  missionTaskId?: string;
  conversationId?: string | null;
};

export function parseCreateSchedule(body: Record<string, unknown>): CreateScheduleInput {
  const kind = body.kind;
  if (typeof kind !== "string" || !(SCHEDULE_KINDS as readonly string[]).includes(kind)) throw new UnprocessableEntityError("kind 必须是 DAILY_BRIEF / REMINDER / MISSION");
  if (typeof body.cron !== "string" || !body.cron.trim()) throw new UnprocessableEntityError("缺少 cron");
  const str = (k: string, max: number) => {
    const v = body[k];
    if (v == null) return undefined;
    if (typeof v !== "string") throw new UnprocessableEntityError(`${k} 必须是字符串`);
    return v.trim().slice(0, max) || undefined;
  };
  const input: CreateScheduleInput = {
    kind: kind as ScheduleKind,
    cron: body.cron.trim(),
    timezone: str("timezone", 64),
    title: str("title", 120),
    text: str("text", 2000),
    missionTaskId: str("missionTaskId", 64),
    conversationId: str("conversationId", 64) ?? null,
  };
  if (input.kind === "REMINDER" && !input.text) throw new UnprocessableEntityError("提醒需要 text");
  if (input.kind === "MISSION" && !input.missionTaskId) throw new UnprocessableEntityError("定时重跑需要 missionTaskId");
  return input;
}

async function assertOwnConversation(session: SessionContext, conversationId: string) {
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: session.organizationId, ownerId: session.userId }, select: { id: true } });
  if (!c) throw new NotFoundError("Conversation not found");
}

export async function createSchedule(session: SessionContext, input: CreateScheduleInput): Promise<ScheduleView> {
  const tz = input.timezone ?? "Asia/Shanghai";
  const nextRunAt = validateCron(input.cron, tz);
  const count = await prisma.kernSchedule.count({ where: { organizationId: session.organizationId, userId: session.userId } });
  if (count >= MAX_SCHEDULES_PER_USER) throw new UnprocessableEntityError(`最多 ${MAX_SCHEDULES_PER_USER} 个定时`);
  let conversationId = input.conversationId ?? null;
  if (conversationId) await assertOwnConversation(session, conversationId);
  let payload: Record<string, unknown> = {};
  let title = input.title;
  if (input.kind === "REMINDER") {
    payload = { text: input.text };
    title ??= input.text!.slice(0, 40);
  } else if (input.kind === "MISSION") {
    const task = await prisma.agentTask.findFirst({
      where: { id: input.missionTaskId, organizationId: session.organizationId, createdByUserId: session.userId },
      select: { goal: true, contextSnapshot: true },
    });
    const snap = task ? readMissionSnapshot(task.contextSnapshot) : null;
    if (!task || !snap) throw new NotFoundError("Mission not found");
    // KX-73：三次成功才自动化——按做法跑、这次已复核通过、做法连续验收 ≥ 3 次。
    const pb = snap.playbookRef
      ? await prisma.kernPlaybook.findFirst({ where: { id: snap.playbookRef.id, organizationId: session.organizationId }, select: { name: true, acceptedStreak: true } })
      : null;
    const gate = automationEligibility({ demo: !!snap.demo, playbook: pb, contract: snap.contract ?? null });
    if (!gate.allowed) throw new UnprocessableEntityError(gate.reason ?? "这项工作还不能转定时");
    payload = { plan: snap.plan, fromMissionTaskId: input.missionTaskId, playbookRef: snap.playbookRef ?? null };
    title ??= `重跑：${task.goal.slice(0, 40)}`;
    conversationId ??= snap.conversationId;
  } else {
    title ??= "每日简报";
    const dup = await prisma.kernSchedule.findFirst({ where: { organizationId: session.organizationId, userId: session.userId, kind: "DAILY_BRIEF" }, select: { id: true } });
    if (dup) throw new UnprocessableEntityError("已经有一个每日简报了，改它的时间即可");
  }
  const row = await prisma.kernSchedule.create({
    data: { organizationId: session.organizationId, userId: session.userId, kind: input.kind, title: title!, cron: input.cron, timezone: tz, payload: toJson(payload), conversationId, nextRunAt },
  });
  return view(row);
}

export async function listSchedules(session: SessionContext): Promise<ScheduleView[]> {
  const rows = await prisma.kernSchedule.findMany({ where: { organizationId: session.organizationId, userId: session.userId }, orderBy: { createdAt: "asc" } });
  return rows.map(view);
}

async function own(session: SessionContext, id: string) {
  const row = await prisma.kernSchedule.findFirst({ where: { id, organizationId: session.organizationId, userId: session.userId } });
  if (!row) throw new NotFoundError("Schedule not found");
  return row;
}

export async function updateSchedule(session: SessionContext, id: string, body: Record<string, unknown>): Promise<ScheduleView> {
  const row = await own(session, id);
  const data: Prisma.KernScheduleUpdateInput = {};
  const cron = typeof body.cron === "string" ? body.cron.trim() : row.cron;
  const tz = typeof body.timezone === "string" ? body.timezone.trim() : row.timezone;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : row.enabled;
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 120);
  if (cron !== row.cron || tz !== row.timezone || (enabled && !row.enabled)) {
    data.cron = cron;
    data.timezone = tz;
    data.nextRunAt = validateCron(cron, tz);
  }
  data.enabled = enabled;
  if (enabled && !row.enabled) data.lastError = null;
  return view(await prisma.kernSchedule.update({ where: { id: row.id }, data }));
}

export async function deleteSchedule(session: SessionContext, id: string): Promise<void> {
  const row = await own(session, id);
  await prisma.kernSchedule.delete({ where: { id: row.id } });
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

type Row = Prisma.KernScheduleGetPayload<object>;

async function sessionFor(row: Row): Promise<SessionContext | null> {
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true, name: true } });
  if (!user) return null;
  return { userId: user.id, organizationId: row.organizationId, userEmail: user.email, userName: user.name ?? user.email };
}

async function targetConversation(row: Row, session: SessionContext): Promise<string> {
  if (row.conversationId) {
    const c = await prisma.conversation.findFirst({ where: { id: row.conversationId, ownerId: session.userId, archivedAt: null }, select: { id: true } });
    if (c) return c.id;
  }
  const title = "Kern 简报";
  const existing = await prisma.conversation.findFirst({ where: { organizationId: row.organizationId, ownerId: session.userId, title, archivedAt: null }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.conversation.create({ data: { organizationId: row.organizationId, ownerId: session.userId, title }, select: { id: true } });
  return created.id;
}

async function post(row: Row, session: SessionContext, content: string): Promise<string> {
  const conversationId = await targetConversation(row, session);
  const m = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: { conversationId, role: "ASSISTANT", content, citations: toJson([{ kind: "kern-schedule", ref: row.id, title: `定时 · ${row.title}` }]) },
      select: { id: true },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return msg;
  });
  return m.id;
}

export async function buildDigestFor(session: SessionContext, since: Date, now = new Date()) {
  const attention = await loadAttentionForUser(session);
  const recent = await prisma.agentTask.findMany({
    where: { organizationId: session.organizationId, createdByUserId: session.userId, updatedAt: { gt: since }, contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" } },
    select: { goal: true, contextSnapshot: true },
    take: 30,
  });
  const finishedSince = recent
    .map((r) => ({ goal: r.goal.slice(0, 60), snap: readMissionSnapshot(r.contextSnapshot) }))
    .filter((r) => r.snap?.outcome?.finishedAt && new Date(r.snap.outcome.finishedAt) > since)
    .map((r) => ({ goal: r.goal, status: r.snap!.outcome!.status as string }));
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const creds = await prisma.kernCredential.findMany({
    where: { organizationId: session.organizationId, userId: session.userId, revokedAt: null, usedAt: null, expiresAt: { gt: now, lte: soon } },
    select: { label: true, target: true, expiresAt: true },
  });
  const broken = await prisma.kernConnector.findMany({
    where: { organizationId: session.organizationId, userId: session.userId, lastError: { not: null } },
    select: { name: true, lastError: true },
  });
  return composeDailyDigest(
    {
      needsYou: attention.needsYou.map((i) => ({ title: i.title, why: i.why })),
      inProgress: attention.inProgress.map((i) => ({ title: i.title, why: i.why })),
      finishedSince,
      expiringCredentials: creds.map((c) => ({ label: c.label, target: c.target, expiresAt: c.expiresAt!.toISOString() })),
      brokenConnectors: broken.map((c) => ({ name: c.name, error: (c.lastError ?? "").slice(0, 120) })),
    },
    now
  );
}

export type ScheduleRunOutcome = { status: "POSTED" | "SKIPPED_EMPTY" | "LAUNCHED" | "FAILED"; detail?: string };

async function execute(row: Row, slot: Date, now: Date): Promise<ScheduleRunOutcome> {
  const session = await sessionFor(row);
  if (!session) return { status: "FAILED", detail: "用户不存在" };
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  if (row.kind === "REMINDER") {
    await post(row, session, `提醒：${String(payload.text ?? row.title)}`);
    return { status: "POSTED" };
  }
  if (row.kind === "DAILY_BRIEF") {
    const since = row.lastRunAt ?? new Date(now.getTime() - 86_400_000);
    const content = await buildDigestFor(session, since, now);
    if (!content) return { status: "SKIPPED_EMPTY" };
    await post(row, session, content);
    return { status: "POSTED" };
  }
  const plan = payload.plan as MissionPlan | undefined;
  if (!plan) return { status: "FAILED", detail: "缺少计划" };
  const conversationId = row.conversationId ?? (await targetConversation(row, session));
  const playbookRef = (payload.playbookRef as { id: string; name: string } | null | undefined) ?? undefined;
  const r = await launchKernMission(session, { plan, conversationId, sourceRunId: `schedule:${row.id}:${slot.toISOString()}`, playbookRef });
  return { status: "LAUNCHED", detail: r.missionTaskId };
}

/** worker 调用：认领并执行到期的定时。返回处理明细。 */
export async function runDueSchedules(opts: { now?: Date; organizationId?: string; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const due = await prisma.kernSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now }, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) },
    orderBy: { nextRunAt: "asc" },
    take: opts.limit ?? 20,
  });
  const results: { id: string; outcome: ScheduleRunOutcome | "LOST_CLAIM" }[] = [];
  for (const row of due) {
    const slot = row.nextRunAt!;
    let next: Date | null = null;
    try {
      next = nextCronRun(row.cron, now, row.timezone);
    } catch {
      next = null;
    }
    // 原子认领：只有把 nextRunAt 从这个 slot 推进走的那个 worker 才执行。错过的多个 slot 合并成一次。
    const claimed = await prisma.kernSchedule.updateMany({
      where: { id: row.id, enabled: true, nextRunAt: slot },
      data: { nextRunAt: next, ...(next ? {} : { enabled: false }) },
    });
    if (claimed.count !== 1) {
      results.push({ id: row.id, outcome: "LOST_CLAIM" });
      continue;
    }
    let outcome: ScheduleRunOutcome;
    try {
      outcome = await execute(row, slot, now);
    } catch (e) {
      outcome = { status: "FAILED", detail: e instanceof Error ? e.message : String(e) };
    }
    const failures = outcome.status === "FAILED" ? row.consecutiveFailures + 1 : 0;
    await prisma.kernSchedule.update({
      where: { id: row.id },
      data: {
        lastRunAt: now,
        lastStatus: outcome.status,
        lastError: outcome.status === "FAILED" ? (outcome.detail ?? "失败").slice(0, 500) : null,
        runCount: { increment: 1 },
        consecutiveFailures: failures,
        // 连续失败 5 次自动停用，避免每天刷错误。
        ...(failures >= 5 ? { enabled: false } : {}),
      },
    });
    results.push({ id: row.id, outcome });
  }
  return { scanned: due.length, results };
}
