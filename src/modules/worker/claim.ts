import { randomUUID } from "node:crypto";
import prisma from "@/shared/db";

/**
 * AgentTask 执行租约（executorLease）。
 *
 * 与 Product R&D QA 的 `qaClaim` 同一套模式，但更简单——这里没有「建下游对象」
 * 的第二阶段，所以不需要独立 fencing 补偿：claim 成功即拿到执行权，
 * 结束后释放，崩溃则等 lease 过期被下一轮重抢。
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
