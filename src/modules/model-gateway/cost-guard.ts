/**
 * P0-D ModelRun 原子 cost guard + 最小 tracing
 * 每次 ModelRun 前原子 check-and-charge, 超额 fail closed
 *
 * 2026-10-12 加固：准入以 `UPDATE "Organization" ... WHERE used < quota` 的
 * **受影响行数**为准 —— 并发下只有先拿到行锁的请求能命中，命中 0 行即拒绝；
 * 拒绝时不写 UsageLedger、不占用配额。
 *
 * 2026-10-13 修正（配额口径）：上面那套判定的计数源是 `Organization.modelCallUsed`，
 * 它**只增不减、从不按月归零** —— 文案说「月度上限」，实际是组织终身累计。
 * 后果：配额用满后该组织**永久**被拒（除失败回滚外没有任何重置路径），
 * 只能人工改库。现在把准入计数换成**按自然月的 UsageLedger 条数**：
 *   - 与「月度」语义一致，跨月自动恢复；
 *   - 并发安全改由组织级 advisory lock 保证（同一组织的准入串行执行，
 *     统计与写入在同一事务内），不再依赖 UPDATE 的命中行数；
 *   - `modelCallUsed` 保留自增，仍作为累计统计字段（账单/排查用），但不再是准入依据。
 *
 * 与 usage 层 `assertModelCallQuotaTx` 的分工：后者守**模型调用**（按 ModelRun 计数，
 * 覆盖每一次 `executePersistedModelGateway`），本闸守**研究抓取等计费事件**
 * （按 UsageLedger 计数）。两者管不同资源、用不同的锁，不互相阻塞。
 */

import prisma from "@/shared/db";
import { UnprocessableEntityError } from "@/shared/errors";
import { calendarMonth } from "@/modules/usage";

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

/** 拒绝文案里的资源名 —— 让用户一眼看出是**哪一类**额度用完了。 */
function describeEvent(eventType: string): string {
  if (eventType === "research_call") return "研究抓取";
  if (eventType === "desktop_action") return "本机动作";
  return "模型调用";
}

export async function checkAndCharge(input: CostGuardInput): Promise<CostGuardResult> {
  return prisma.$transaction(async (tx) => {
    // 0. 组织级准入串行化。准入依据是「本月已发生的事件条数」，统计与后续写入
    //    必须在同一把锁内完成，否则并发请求会各自读到同一个旧计数、一起放行。
    //    lock key 与 usage 层的模型调用闸不同 —— 两者管不同资源，不该互相阻塞。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"kern-cost-guard:" + input.organizationId}))`;

    // 1. 获取组织配额
    const org = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, modelCallQuota: true, modelCallUsed: true },
    });

    // 若无配额字段，使用默认值
    const limit = (org as any)?.modelCallQuota ?? MONTHLY_LIMIT_DEFAULT;

    // 2. 本月已用量 —— 准入的**唯一**依据（按自然月统计，跨月自动归零）。
    //    按 eventType 分别计数：研究抓取不占用模型调用的名额，反之亦然。
    //    `releaseReservation` 失败回滚会把该行改写成 model_call_failed，
    //    于是它自动退出本计数 —— 配额随之退还。
    const eventType = input.eventType ?? "model_call";
    const period = calendarMonth();
    const monthlyUsed = await tx.usageLedger.count({
      where: {
        organizationId: input.organizationId,
        eventType,
        createdAt: { gte: period.start, lt: period.end },
      },
    });

    const refuse = (used: number, reason: string): CostGuardResult => ({
      allowed: false,
      remaining: Math.max(0, limit - used),
      limit,
      used,
      reason,
    });

    if (monthlyUsed >= limit) {
      return refuse(
        monthlyUsed,
        `本月${describeEvent(eventType)}已达上限 ${limit} 次，剩余 0，当前 ${monthlyUsed}，需等待下月或申请扩容`
      );
    }

    // 3. 预留并消费 (reserve → consume)
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 累计统计自增 —— **不再是准入依据**，仅供账单与事后排查。
    // 命中 0 行说明组织不存在，保守拒绝（fail closed）。
    const charged = await tx.$executeRaw`
      UPDATE "Organization"
      SET "modelCallUsed" = COALESCE("modelCallUsed", 0) + 1,
          "updatedAt" = NOW()
      WHERE id = ${input.organizationId}
    `;
    if (charged === 0) {
      return refuse(monthlyUsed, "组织不存在或已被删除，拒绝计费请求");
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

    // 放行后的本月已用量：UsageLedger 行已在同一个事务（同一把锁）内写入，
    // 直接 +1 即可 —— 不需要再回读组织列，也不该再拿累计列做算术。
    const chargedUsed = monthlyUsed + 1;
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
