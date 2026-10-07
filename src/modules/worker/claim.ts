import { randomUUID } from "node:crypto";
import prisma from "@/shared/db";
import { PROCESS_WORKER_ID } from "./heartbeat";

/**
 * AgentTask 执行租约（executorLease）。
 *
 * 领取 token 同时用于模型/工具调用前检查、事件写入和事务提交。
 * 取消或接管会使旧 token 失效；旧执行者不能提交结果或释放新执行者的租约。
 *
 * 形态：`contextSnapshot.executorLease = {token, claimedAt, expiresAt}`
 * - 完成后由 `releaseAgentTaskClaim` **删除**（而不是留一个已落定的对象），
 *   这样任务因 executor 失败被重新排队时，新租约能正常拿；崩溃场景则靠
 *   expiresAt 过期回收。两种恢复路径互不干扰。
 */
export const EXECUTOR_LEASE_MS = 10 * 60_000;

/** 抢占执行权，返回 fencing token；未抢到（被别人持有或任务不可执行）返回 null。 */
export async function claimAgentTaskForExecution(
  taskId: string,
  organizationId: string
): Promise<string | null> {
  const now = new Date();
  const token = randomUUID();
  const lease = JSON.stringify({
    token,
    owner: PROCESS_WORKER_ID,
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EXECUTOR_LEASE_MS).toISOString(),
  });
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentTask"
       SET "contextSnapshot" = jsonb_set(
             COALESCE("contextSnapshot", '{}'::jsonb),
             '{executorLease}',
             ${lease}::jsonb,
             true
           )
     WHERE id = ${taskId}
       AND "organizationId" = ${organizationId}
       AND "status" = 'QUEUED'
       AND "availableAt" <= now()
       AND (
            COALESCE("contextSnapshot" -> 'executorLease' ->> 'expiresAt', '') = ''
         OR ("contextSnapshot" -> 'executorLease' ->> 'expiresAt')::timestamptz < now()
       )
    RETURNING id
  `;
  return claimed.length > 0 ? token : null;
}

/** 释放执行权。带 token：旧 owner 不能删掉新 owner 的租约。 */
export async function releaseAgentTaskClaim(
  taskId: string,
  organizationId: string,
  token: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AgentTask"
       SET "contextSnapshot" = COALESCE("contextSnapshot", '{}'::jsonb) - 'executorLease'
     WHERE id = ${taskId}
       AND "organizationId" = ${organizationId}
       AND COALESCE("contextSnapshot" -> 'executorLease' ->> 'token', '') = ${token}
  `;
}

/** 只读：当前是否已有未过期的执行租约（供 loop 提前跳过，省一次 UPDATE）。 */
export async function hasLiveExecutorLease(
  taskId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ live: boolean }>>`
    SELECT (
      COALESCE("contextSnapshot" -> 'executorLease' ->> 'expiresAt', '') <> ''
      AND ("contextSnapshot" -> 'executorLease' ->> 'expiresAt')::timestamptz >= now()
    ) AS live
      FROM "AgentTask"
     WHERE id = ${taskId}
  `;
  return rows[0]?.live === true;
}

export class ExecutionStoppedError extends Error {
  constructor(message = "任务已取消或执行权已被接管") { super(message); this.name = "ExecutionStoppedError"; }
}

export interface ExecutorGuard {
  taskId: string;
  organizationId: string;
  token: string;
  runId?: string;
}

export interface ExecutorCommit {
  token: string;
  result?: Record<string, unknown>;
  state?: Record<string, unknown>;
  dataGaps?: { fieldKey: string; fieldName: string; description: string }[];
  retryAt?: Date | null;
  releaseLease?: boolean;
}

/** Fresh admission check before each model/tool call, including gateway retries. */
export async function assertExecutorActive(guard: ExecutorGuard, db: import("@prisma/client").Prisma.TransactionClient = prisma): Promise<void> {
  const task = await db.agentTask.findFirst({
    where: { id: guard.taskId, organizationId: guard.organizationId, status: "RUNNING",
      contextSnapshot: { path: ["executorLease", "token"], equals: guard.token },
      ...(guard.runId ? { runs: { some: { id: guard.runId, status: "RUNNING" } } } : {}),
    },
    select: { contextSnapshot: true, parentTask: { select: { status: true, contextSnapshot: true } } },
  });
  if (!task) throw new ExecutionStoppedError();
  const parent = task.parentTask;
  const root = parent?.contextSnapshot as { schemaVersion?: string; state?: { nodes?: Record<string, { status?: string; taskId?: string }> } } | null;
  if (root?.schemaVersion === "kern-mission/v1") {
    const key = (task.contextSnapshot as { nodeKey?: string } | null)?.nodeKey ?? "";
    const node = root.state?.nodes?.[key];
    if (parent?.status !== "RUNNING" || node?.status !== "ACTIVE" || node.taskId !== guard.taskId) throw new ExecutionStoppedError();
  }
}

/** Consistent root → child lock order prevents cancellation/commit races and deadlocks. */
export async function lockExecutorGuardTx(tx: import("@prisma/client").Prisma.TransactionClient, guard: ExecutorGuard): Promise<void> {
  const task = await tx.agentTask.findFirst({ where: { id: guard.taskId, organizationId: guard.organizationId }, select: { parentTaskId: true } });
  if (task?.parentTaskId) await tx.$queryRaw`SELECT id FROM "AgentTask" WHERE id = ${task.parentTaskId} AND "organizationId" = ${guard.organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AgentTask" WHERE id = ${guard.taskId} AND "organizationId" = ${guard.organizationId} FOR UPDATE`;
  await assertExecutorActive(guard, tx);
}
