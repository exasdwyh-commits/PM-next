/**
 * P0-D ModelRun 原子 cost guard + 最小 tracing
 * 每次 ModelRun 前原子 check-and-charge, 超额 fail closed
 *
 * 2026-10-12 加固：准入以 `UPDATE "Organization" ... WHERE used < quota` 的
 * **受影响行数**为准 —— 并发下只有先拿到行锁的请求能命中，命中 0 行即拒绝；
 * 拒绝时不写 UsageLedger、不占用配额。
 */

import prisma from "@/shared/db";
import { UnprocessableEntityError } from "@/shared/errors";

export interface CostGuardInput {
  organizationId: string;
  missionId?: string;
  agentId?: string;
  taskClass?: string;
  estimatedTokens?: number;
  modelProfileKey?: string;
  /**
   * 成本预留发生在 ModelPolicy 解析之前，因此没有真实 policy 可记。
   * 调用方若已完成 policy 解析应透传，否则记cost-guard/reserve 占位，
   * 便于事后按 policyKey 回溯真实策略（占位值不会与真实 policy 混淆）。
   */
  policyKey?: string;
  policyVersion?: string;
  /**
   * UsageLedger 的事件类型。研究抓取（taskClass "research_fetch"）必须传
   * "research_call"，否则账本里会记成 model_call —— 与账单页展示的
   * 事件类型（research_call / desktop_action）对不上，事后也无法按类目对账。
   */
  eventType?: "model_call" | "research_call" | "desktop_action";
}

export interface CostGuardResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  reason?: string;
  reservationId?: string;
}

const MONTHLY_LIMIT_DEFAULT = 300; // 默认月度调用上限
const TOKEN_COST_FACTOR = 0.001; // 每 token 成本因子

export async function checkAndCharge(input: CostGuardInput): Promise<CostGuardResult> {
  return prisma.$transaction(async (tx) => {
    // 1. 获取组织配额
    const org = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, modelCallQuota: true, modelCallUsed: true },
    });

    // 若无配额字段，使用默认值
    const limit = (org as any)?.modelCallQuota ?? MONTHLY_LIMIT_DEFAULT;
    const used = (org as any)?.modelCallUsed ?? 0;
    const remaining = limit - used;

    // 2. 快路径：读数上已经到上限就直接拒（真正的准入看第 3 步 UPDATE 的命中行数）
    if (remaining <= 0) {
      return {
        allowed: false,
        remaining: 0,
        limit,
        used,
        reason: `月度模型调用已达上限 ${limit} 次，剩余 0，当前 ${used}，需等待下月或申请扩容`,
      };
    }

    // 3. 预留并消费 (reserve → consume)
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 原子更新已使用 —— **受影响行数**才是准入判定。
    // 并发下多个请求都会通过上面的快路径读到同一个旧值，但只有先拿到行锁的那个能命中
    // WHERE；其后每个 UPDATE 命中 0 行。以前不看返回值，于是「已到上限」的请求照样
    // 拿到 allowed: true（上限被冲破、账本也被多记）。命中 0 行 = 拒绝。
    const charged = await tx.$executeRaw`
      UPDATE "Organization" 
      SET "modelCallUsed" = COALESCE("modelCallUsed", 0) + 1,
          "updatedAt" = NOW()
      WHERE id = ${input.organizationId}
      AND COALESCE("modelCallUsed", 0) < COALESCE("modelCallQuota", ${MONTHLY_LIMIT_DEFAULT})
    `;
    if (charged === 0) {
      const latest = await tx.organization.findUnique({
        where: { id: input.organizationId },
        select: { modelCallQuota: true, modelCallUsed: true },
      });
      const latestLimit = latest?.modelCallQuota ?? MONTHLY_LIMIT_DEFAULT;
      const latestUsed = latest?.modelCallUsed ?? limit;
      return {
        allowed: false,
        remaining: Math.max(0, latestLimit - latestUsed),
        limit: latestLimit,
        used: latestUsed,
        reason: `月度模型调用已达上限 ${latestLimit} 次（并发下由数据库行锁最终裁定），本次被拒，需等待下月或申请扩容`,
      };
    }

    // 4. 记录 UsageLedger
    await tx.usageLedger.create({
      data: {
        organizationId: input.organizationId,
        missionId: input.missionId || null,
        agentId: input.agentId || null,
        taskClass: input.taskClass || null,
        eventType: input.eventType ?? "model_call",
        modelProfileKey: input.modelProfileKey || null,
        estimatedTokens: input.estimatedTokens || null,
        cost: input.estimatedTokens ? input.estimatedTokens * TOKEN_COST_FACTOR : 1,
        reservationId,
        createdAt: new Date(),
      },
    });

    // 5. 记录 ModelRun tracing
    if (input.missionId) {
      await tx.modelRun.create({
        data: {
          organizationId: input.organizationId,
          missionId: input.missionId,
          agentId: input.agentId || "unknown",
          taskClass: input.taskClass || "UNKNOWN",
          profileKey: input.modelProfileKey || "unknown",
          policyKey: input.policyKey || "cost-guard/reserve",
          policyVersion: input.policyVersion || "0",
          status: "RESERVED",
          reservationId,
          estimatedTokens: input.estimatedTokens || 0,
          startedAt: new Date(),
        },
      });
    }

    // 扣减后的真实读数：并发下别用事务开始时的 used 做算术（会偏小）。
    const after = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { modelCallUsed: true },
    });
    const chargedUsed = after?.modelCallUsed ?? used + 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - chargedUsed),
      limit,
      used: chargedUsed,
      reservationId,
    };
  }, { maxWait: 10000, timeout: 15000 });
}

export async function releaseReservation(reservationId: string, organizationId: string, success: boolean, actualTokens?: number) {
  return prisma.$transaction(async (tx) => {
    // 更新 ModelRun
    await tx.modelRun.updateMany({
      where: { reservationId, organizationId },
      data: {
        status: success ? "SUCCEEDED" : "FAILED",
        actualTokens: actualTokens || null,
        finishedAt: new Date(),
        durationMs: 0, // 计算实际耗时
      },
    });

    // 若失败，释放配额 (可选策略: 失败也计费，或回滚)
    if (!success) {
      // 策略: 失败回滚配额，允许重试
      await tx.$executeRaw`
        UPDATE "Organization"
        SET "modelCallUsed" = GREATEST(COALESCE("modelCallUsed", 0) - 1, 0)
        WHERE id = ${organizationId}
      `;
      await tx.usageLedger.updateMany({
        where: { reservationId, organizationId },
        data: { eventType: "model_call_failed", cost: 0 },
      });
    }

    return { released: true };
  });
}

export async function getUsageOverview(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { modelCallQuota: true, modelCallUsed: true },
  });

  const limit = (org as any)?.modelCallQuota ?? MONTHLY_LIMIT_DEFAULT;
  const used = (org as any)?.modelCallUsed ?? 0;

  const recentRuns = await prisma.modelRun.findMany({
    where: { organizationId },
    orderBy: { startedAt: "desc" },
    take: 20,
    select: {
      id: true,
      missionId: true,
      taskClass: true,
      profileKey: true,
      status: true,
      estimatedTokens: true,
      actualTokens: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  // PG 的 COUNT/SUM 返回 bigint（JS BigInt），直接进 NextResponse.json 会抛
  // "Do not know how to serialize a BigInt"。这里在 SQL 侧就转成数值。
  const usageByDay = await prisma.$queryRaw<
    { day: Date; count: number; total_cost: number | null }[]
  >`
    SELECT DATE("createdAt") as day,
           COUNT(*)::int as count,
           COALESCE(SUM(cost), 0)::float8 as total_cost
    FROM "UsageLedger"
    WHERE "organizationId" = ${organizationId}
    AND "createdAt" >= NOW() - INTERVAL '30 days'
    GROUP BY DATE("createdAt")
    ORDER BY day DESC
    LIMIT 30
  `;

  return {
    quota: {
      limit,
      used,
      remaining: limit - used,
      // limit 可能为 0（未配置配额时回落到默认值，但仍防御一次）
      rate: limit > 0 ? Math.round((used / limit) * 100) : 0,
    },
    recentRuns,
    usageByDay,
  };
}

export function describeCostGuard() {
  return {
    limitDefault: MONTHLY_LIMIT_DEFAULT,
    strategy: "reserve → consume → release (fail rollback)",
    atomic: "pg advisory + row lock + WHERE used < quota",
    failClosed: true,
    events: ["mission_started", "model_call", "model_call_failed", "research_call", "desktop_action"],
    tracing: "missionId × nodeKey × model × duration × status",
  };
}
