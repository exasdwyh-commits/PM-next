import { randomUUID } from "node:crypto";
import os from "node:os";
import prisma from "@/shared/db";

/**
 * KX-34b · Worker 心跳（数据库）。
 *
 * 文件锁（.pm-worker/lock.json）只保证「同一台机器上只有一个 Worker」；网页进程、
 * 其他机器上的 Worker 看不到它。这里把心跳写进数据库，用来：
 *  1. 判断执行租约的持有者是否还活着（崩溃恢复不必等 10 分钟租约过期）；
 *  2. 在界面上告诉用户「后台 Worker 是否在运行」（定时和任务推进都依赖它）。
 */
export const PROCESS_WORKER_ID = randomUUID();
/** 心跳超过这个时间没更新，就认为该 Worker 已经死了。 */
export const WORKER_STALE_MS = 90_000;
const BEAT_THROTTLE_MS = 10_000;

let lastBeatAt = 0;

export async function beatWorker(info: { loops: string[]; startedAt: Date; organizationId?: string }, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastBeatAt < BEAT_THROTTLE_MS) return;
  lastBeatAt = now;
  await prisma.pmWorkerHeartbeat.upsert({
    where: { workerId: PROCESS_WORKER_ID },
    create: { organizationId: info.organizationId ?? null, scopeKnown: true, workerId: PROCESS_WORKER_ID, pid: process.pid, host: os.hostname(), loops: info.loops, startedAt: info.startedAt, heartbeatAt: new Date(now) },
    update: { organizationId: info.organizationId ?? null, scopeKnown: true, heartbeatAt: new Date(now), loops: info.loops, stoppedAt: null },
  });
}

export async function markWorkerStopped(): Promise<void> {
  await prisma.pmWorkerHeartbeat.updateMany({ where: { workerId: PROCESS_WORKER_ID }, data: { stoppedAt: new Date() } });
  lastBeatAt = 0;
}

export type WorkerHealthStatus = "running" | "stale" | "stopped" | "never";
export interface WorkerHealth {
  status: WorkerHealthStatus;
  running: number;
  heartbeatAt: string | null;
  startedAt: string | null;
}

type BeatRow = { heartbeatAt: Date; startedAt: Date; stoppedAt: Date | null };

/** 纯函数：由心跳行判定健康度。有一个活着就是 running。 */
export function classifyWorkerHealth(rows: BeatRow[], now = new Date()): WorkerHealth {
  if (!rows.length) return { status: "never", running: 0, heartbeatAt: null, startedAt: null };
  const alive = rows.filter((r) => !r.stoppedAt && now.getTime() - r.heartbeatAt.getTime() < WORKER_STALE_MS);
  const latest = [...(alive.length ? alive : rows)].sort((a, b) => b.heartbeatAt.getTime() - a.heartbeatAt.getTime())[0];
  const status: WorkerHealthStatus = alive.length ? "running" : latest.stoppedAt ? "stopped" : "stale";
  return { status, running: alive.length, heartbeatAt: latest.heartbeatAt.toISOString(), startedAt: latest.startedAt.toISOString() };
}

export async function getWorkerHealth(now = new Date(), scope: { organizationId?: string; loop?: string } = {}): Promise<WorkerHealth> {
  const rows = await prisma.pmWorkerHeartbeat.findMany({ where: {
    ...(scope.organizationId ? { scopeKnown: true, OR: [{ organizationId: null }, { organizationId: scope.organizationId }] } : {}),
    ...(scope.loop ? { loops: { array_contains: [scope.loop] } } : {}),
  }, orderBy: { heartbeatAt: "desc" }, take: 20, select: { heartbeatAt: true, startedAt: true, stoppedAt: true } });
  return classifyWorkerHealth(rows, now);
}

/** 租约持有者是否还活着。本进程永远算活着；没有心跳行的给一个宽限期（按租约领取时间）。 */
export async function isWorkerAlive(workerId: string, claimedAt: Date | null, now = new Date()): Promise<boolean> {
  if (workerId === PROCESS_WORKER_ID) return true;
  const row = await prisma.pmWorkerHeartbeat.findUnique({ where: { workerId }, select: { heartbeatAt: true, stoppedAt: true } });
  if (!row) return !!claimedAt && now.getTime() - claimedAt.getTime() < WORKER_STALE_MS;
  return !row.stoppedAt && now.getTime() - row.heartbeatAt.getTime() < WORKER_STALE_MS;
}
