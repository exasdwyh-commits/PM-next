import { KernPlanTier, type Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { AppError } from "@/shared/errors";

/**
 * Plans & metering
 * ================
 * The unit users understand is “a piece of work Kern takes on” (a mission),
 * not tokens. Model calls are metered too, as a cost guard.
 * `null` = unlimited. Deployments may override via KERN_PLAN_<TIER>_MISSIONS.
 */

export interface PlanLimits {
  label: string;
  priceLabel: string;
  missionsPerMonth: number | null;
  modelCallsPerMonth: number | null;
  memoryItems: number | null;
}

export const PLANS: Record<KernPlanTier, PlanLimits> = {
  FREE: { label: "免费版", priceLabel: "¥0", missionsPerMonth: 5, modelCallsPerMonth: 300, memoryItems: 50 },
  PRO: { label: "专业版", priceLabel: "¥149/月", missionsPerMonth: 60, modelCallsPerMonth: 6000, memoryItems: 1000 },
  TEAM: { label: "团队版", priceLabel: "按席位", missionsPerMonth: null, modelCallsPerMonth: null, memoryItems: null },
};

export function limitsFor(tier: KernPlanTier): PlanLimits {
  const base = PLANS[tier];
  const env = process.env[`KERN_PLAN_${tier}_MISSIONS`];
  if (env === undefined) return base;
  const n = Number.parseInt(env, 10);
  return { ...base, missionsPerMonth: Number.isFinite(n) && n >= 0 ? n : null };
}

export class QuotaExceededError extends AppError {
  constructor(
    message: string,
    public readonly quota: { metric: "missions" | "modelCalls" | "memoryItems"; used: number; limit: number; tier: KernPlanTier }
  ) {
    super(message, "QUOTA_EXCEEDED", 402);
  }
}

/** Monthly window anchored on the subscription start day (pure). */
export function currentPeriod(anchor: Date, now = new Date()): { start: Date; end: Date } {
  const day = Math.min(anchor.getUTCDate(), 28);
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (start > now) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day));
  return { start, end };
}

export async function getSubscription(organizationId: string) {
  const row = await prisma.organizationSubscription.findUnique({ where: { organizationId } });
  return row ?? { organizationId, tier: KernPlanTier.FREE, externalRef: null, currentPeriodStart: new Date(Date.UTC(2026, 0, 1)) };
}

export async function getUsage(organizationId: string) {
  const sub = await getSubscription(organizationId);
  const limits = limitsFor(sub.tier);
  const period = currentPeriod(sub.currentPeriodStart);
  const [missions, modelCalls] = await Promise.all([
    prisma.agentTask.count({
      where: {
        organizationId,
        parentTaskId: null,
        createdAt: { gte: period.start, lt: period.end },
        contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" },
      },
    }),
    prisma.modelRun.count({ where: { organizationId, createdAt: { gte: period.start, lt: period.end } } }),
  ]);
  return { tier: sub.tier, limits, period, used: { missions, modelCalls } };
}

/** Throws QuotaExceededError when a new mission would exceed the plan. */
export async function assertMissionQuota(organizationId: string) {
  const u = await getUsage(organizationId);
  const limit = u.limits.missionsPerMonth;
  if (limit !== null && u.used.missions >= limit) {
    throw new QuotaExceededError(`本期 ${u.limits.label} 的 ${limit} 项工作额度已用完`, {
      metric: "missions",
      used: u.used.missions,
      limit,
      tier: u.tier,
    });
  }
  const callLimit = u.limits.modelCallsPerMonth;
  if (callLimit !== null && u.used.modelCalls >= callLimit) {
    throw new QuotaExceededError(`本期 ${u.limits.label} 的模型调用额度已用完`, {
      metric: "modelCalls",
      used: u.used.modelCalls,
      limit: callLimit,
      tier: u.tier,
    });
  }
  return u;
}

/**
 * Memory quota: active (not forgotten) KernMemory rows per organization.
 * Must be called inside the same transaction as the insert, after taking the
 * per-organization advisory lock, so concurrent "记住" requests cannot overshoot.
 */
export async function assertMemoryQuotaTx(
  tx: Prisma.TransactionClient,
  organizationId: string
) {
  const sub = await tx.organizationSubscription.findUnique({ where: { organizationId } });
  const tier = sub?.tier ?? KernPlanTier.FREE;
  const limits = limitsFor(tier);
  if (limits.memoryItems === null) return;
  const used = await tx.kernMemory.count({ where: { organizationId, forgottenAt: null } });
  if (used >= limits.memoryItems) {
    throw new QuotaExceededError(
      `本期 ${limits.label} 的 ${limits.memoryItems} 条记忆额度已用完，可以先在「设置 → Kern 的记忆」里删除不再需要的记忆`,
      { metric: "memoryItems", used, limit: limits.memoryItems, tier }
    );
  }
}

export async function setOrganizationTier(organizationId: string, tier: KernPlanTier, externalRef?: string | null) {
  return prisma.organizationSubscription.upsert({
    where: { organizationId },
    create: { organizationId, tier, externalRef: externalRef ?? null },
    update: { tier, externalRef: externalRef ?? undefined },
  });
}
