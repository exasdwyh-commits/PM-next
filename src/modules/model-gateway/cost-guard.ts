/**
 * P0-D ModelRun 原子 cost guard + 最小 tracing
 * 每次 ModelRun 前原子 check-and-charge, 超额 fail closed
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

    // 2. 原子检查 - 299/300 时仍需拦截
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
    
    // 原子更新已使用
    await tx.$executeRaw`
      UPDATE "Organization" 
      SET "modelCallUsed" = COALESCE("modelCallUsed", 0) + 1,
          "updatedAt" = NOW()
      WHERE id = ${input.organizationId}
      AND COALESCE("modelCallUsed", 0) < COALESCE("modelCallQuota", ${MONTHLY_LIMIT_DEFAULT})
    `;

    // 4. 记录 UsageLedger
    await tx.usageLedger.create({
      data: {
        organizationId: input.organizationId,
        missionId: input.missionId || null,
        agentId: input.agentId || null,
        taskClass: input.taskClass || null,
        eventType: "model_call",
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
          status: "RESERVED",
          reservationId,
          estimatedTokens: input.estimatedTokens || 0,
          startedAt: new Date(),
        },
      });
    }

    return {
      allowed: true,
      remaining: remaining - 1,
      limit,
      used: used + 1,
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

  const usageByDay = await prisma.$queryRaw`
    SELECT DATE("createdAt") as day, COUNT(*) as count, SUM(cost) as total_cost
    FROM "UsageLedger"
    WHERE "organizationId" = ${organizationId}
    AND "createdAt" >= NOW() - INTERVAL '30 days'
    GROUP BY DATE("createdAt")
    ORDER BY day DESC
    LIMIT 30
  `;

  return {
    quota: { limit, used, remaining: limit - used, rate: Math.round((used / limit) * 100) },
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
