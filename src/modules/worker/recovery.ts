import { randomUUID } from "node:crypto";
import { AgentTaskStatus } from "@prisma/client";
import prisma from "@/shared/db";
import { MAX_EXECUTOR_ATTEMPTS } from "./backoff";
import { isWorkerAlive } from "./heartbeat";
import { resolveWorkerSession } from "./identity";
import { lockExecutorGuardTx, releaseAgentTaskClaim, ExecutionStoppedError } from "./claim";
import { workerHandlers } from "./registry";

/**
 * KX-34b · 崩溃恢复：接管「孤儿」RUNNING 任务。
 *
 * 执行器只领取 QUEUED 任务，startAgentTask 会把它改成 RUNNING。如果 Worker 在
 * 执行途中崩溃，任务会永远停在 RUNNING（租约过期也没人再领），任务树随之卡死。
 *
 * 判定孤儿（必须带 executorLease，supervising 的任务根没有租约，不会被误伤）：
 *  - 租约记录了持有者 owner：持有者心跳失联（> 90s）或已停止 → 孤儿；
 *    持有者还活着就算租约过期也不动（只是慢，不是死）。
 *  - 旧租约没有 owner：租约过期 → 孤儿。
 *
 * 接管：先用原子 UPDATE 把租约 token 换成恢复标记（多个 Worker 同时扫到也只有一个成功），
 * 再走 finishAgentTask(FAILED) 正常关闭 AgentRun，和执行器异常时同一路径：
 * 还有重试额度就重新排队，用完就保持 FAILED，由上层任务按失败处理，不会挂起。
 */
export interface RecoveryResult {
  scanned: number;
  requeued: string[];
  failed: string[];
}

type LeaseRow = { id: string; organizationId: string; lease: { token?: string; owner?: string; claimedAt?: string; expiresAt?: string } | null };

export async function recoverOrphanedTasks(opts: { organizationId?: string; now?: Date; limit?: number } = {}): Promise<RecoveryResult> {
  const now = opts.now ?? new Date();
  const org = opts.organizationId ?? null;
  const rows = await prisma.$queryRaw<LeaseRow[]>`
    SELECT id, "organizationId", "contextSnapshot" -> 'executorLease' AS lease
      FROM "AgentTask"
     WHERE status = 'RUNNING'
       AND "contextSnapshot" ? 'executorLease'
       AND (${org}::text IS NULL OR "organizationId" = ${org})
     ORDER BY "updatedAt" ASC
     LIMIT ${opts.limit ?? 50}
  `;
  const result: RecoveryResult = { scanned: rows.length, requeued: [], failed: [] };
  for (const row of rows) {
    const lease = row.lease ?? {};
    if (!lease.token) continue;
    const expired = !!lease.expiresAt && new Date(lease.expiresAt) < now;
    const orphan = lease.owner ? !(await isWorkerAlive(lease.owner, lease.claimedAt ? new Date(lease.claimedAt) : null, now)) : expired;
    if (!orphan) continue;
    const outcome = await takeOver(row, lease.token, now).catch((error: unknown) => {
      console.error(`[pm-worker] 恢复失败 task=${row.id}:`, error instanceof Error ? error.message : error);
      return null;
    });
    if (outcome === "requeued") result.requeued.push(row.id);
    else if (outcome === "failed") result.failed.push(row.id);
  }
  return result;
}

async function takeOver(row: LeaseRow, oldToken: string, now: Date): Promise<"requeued" | "failed" | null> {
  const token = `recovery:${randomUUID()}`;
  const marker = JSON.stringify({ token, claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), recovering: true });
  const stolen = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentTask" SET "contextSnapshot" = jsonb_set("contextSnapshot", '{executorLease}', ${marker}::jsonb, true)
    WHERE id = ${row.id} AND "organizationId" = ${row.organizationId} AND status = 'RUNNING'
      AND "contextSnapshot" -> 'executorLease' ->> 'token' = ${oldToken} RETURNING id
  `;
  if (!stolen.length) return null;
  try {
    const task = await prisma.agentTask.findUniqueOrThrow({ where: { id: row.id }, select: { contextSnapshot: true } });
    const ctx = (task.contextSnapshot ?? {}) as Record<string, unknown>;
    const state = (ctx.executorState ?? {}) as Record<string, unknown>;
    const attempts = Number(state.attempts ?? 0) + 1;
    const retry = attempts < MAX_EXECUTOR_ATTEMPTS;
    const reason = `Worker 在执行中断开（第 ${attempts}/${MAX_EXECUTOR_ATTEMPTS} 次）`;
    const nextState = { ...state, attempts, lastError: reason, lastOutcome: "INTERRUPTED", nextRetryAt: null, finishedAt: now.toISOString() };
    const run = await prisma.agentRun.findFirst({ where: { agentTaskId: row.id, status: "RUNNING" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (run) {
      const session = await resolveWorkerSession(row.organizationId);
      await workerHandlers().lifecycle.finishAgentTask(session, row.id, {
        runId: run.id, outcome: "FAILED", reason, resultSummary: `${reason}，${retry ? "已自动重新排队" : "重试次数已用完"}`,
        executor: { token, state: nextState, retryAt: retry ? now : null, releaseLease: true },
      });
    } else {
      await prisma.$transaction(async tx => {
        await lockExecutorGuardTx(tx, { taskId: row.id, organizationId: row.organizationId, token });
        const current = await tx.agentTask.findUniqueOrThrow({ where: { id: row.id } });
        const snapshot = { ...(current.contextSnapshot as Record<string, unknown>), executorState: nextState };
        delete (snapshot as Record<string, unknown>).executorLease;
        await tx.agentTask.update({ where: { id: row.id }, data: {
          status: retry ? AgentTaskStatus.QUEUED : AgentTaskStatus.FAILED, availableAt: now,
          blockedReason: `${reason}${retry ? "，已自动重新排队" : ""}`, contextSnapshot: JSON.parse(JSON.stringify(snapshot)),
        } });
      });
    }
    return retry ? "requeued" : "failed";
  } catch (error) {
    if (error instanceof ExecutionStoppedError) { await releaseAgentTaskClaim(row.id, row.organizationId, token); return null; }
    throw error;
  }
}
