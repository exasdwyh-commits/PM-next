import type { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { AppError } from "@/shared/errors";

/**
 * 用量（KX-37 去付费化）
 * =====================
 * Kern 不在产品内收费：没有套餐、价格、升级。合作按 toB 定制单独签约，不进产品。
 *
 * 这里只保留两件事：
 *  1. **用量透明**：本月 Kern 接手了多少项工作、调用了多少次模型（设置页、任务简报里展示）。
 *  2. **部署级安全上限（可选）**：定制部署可以用环境变量给模型花费设一道闸，防止失控；
 *     不设置就是不限。命中时提示“联系管理员”，而不是“升级套餐”。
 *       KERN_LIMIT_MISSIONS_PER_MONTH / KERN_LIMIT_MODEL_CALLS_PER_MONTH / KERN_LIMIT_MEMORY_ITEMS
 *
 * 周期是业务时区（Asia/Shanghai）的自然月。演示运行不计入。
 */

export interface UsageLimits {
  missionsPerMonth: number | null;
  modelCallsPerMonth: number | null;
  memoryItems: number | null;
}

const ENV_KEYS: Record<keyof UsageLimits, string> = {
  missionsPerMonth: "KERN_LIMIT_MISSIONS_PER_MONTH",
  modelCallsPerMonth: "KERN_LIMIT_MODEL_CALLS_PER_MONTH",
  memoryItems: "KERN_LIMIT_MEMORY_ITEMS",
};

/** 纯函数：从环境变量读部署上限。缺省、空、非法、负数都视为不限。 */
export function deploymentLimits(env: Record<string, string | undefined> = process.env): UsageLimits {
  const read = (key: string) => {
    const raw = env[key]?.trim();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    missionsPerMonth: read(ENV_KEYS.missionsPerMonth),
    modelCallsPerMonth: read(ENV_KEYS.modelCallsPerMonth),
    memoryItems: read(ENV_KEYS.memoryItems),
  };
}

/** 纯函数：业务时区（UTC+8，无夏令时）的自然月 [start, end)。 */
export function calendarMonth(now = new Date(), offsetHours = 8): { start: Date; end: Date } {
  const local = new Date(now.getTime() + offsetHours * 3_600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - offsetHours * 3_600_000),
    end: new Date(Date.UTC(y, m + 1, 1) - offsetHours * 3_600_000),
  };
}

export type UsageMetric = "missions" | "modelCalls" | "memoryItems";

export class UsageLimitError extends AppError {
  constructor(
    message: string,
    public readonly usage: { metric: UsageMetric; used: number; limit: number }
  ) {
    super(message, "USAGE_LIMIT_REACHED", 429);
  }
}

/** Running reservations protect concurrent admission; closed unsent attempts release their slot.
 * Historical rows have unknown transport provenance and remain conservatively charged. */
export const CHARGED_MODEL_ATTEMPT_WHERE: Prisma.ModelRunWhereInput = {
  OR: [{ transportKnown: false }, { transportStartedAt: { not: null } }, { status: "RUNNING" }],
};

export async function getUsage(organizationId: string, now = new Date()) {
  const limits = deploymentLimits();
  const period = calendarMonth(now);
  const missionWhere = {
    organizationId,
    parentTaskId: null,
    createdAt: { gte: period.start, lt: period.end },
    contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" },
  };
  // 演示不计入。用 总数 − 演示数：JSON path 的 NOT 会把没有 demo 键的行也排除掉。
  const modelWhere = { organizationId, createdAt: { gte: period.start, lt: period.end } };
  const [allMissions, demoMissions, modelCalls, knownModelAttempts, modelReservations, unknownModelAttempts] = await Promise.all([
    prisma.agentTask.count({ where: missionWhere }),
    prisma.agentTask.count({ where: { ...missionWhere, AND: [{ contextSnapshot: { path: ["demo"], equals: true } }] } }),
    prisma.modelRun.count({ where: { ...modelWhere, ...CHARGED_MODEL_ATTEMPT_WHERE } }),
    prisma.modelRun.count({ where: { ...modelWhere, transportKnown: true, transportStartedAt: { not: null } } }),
    prisma.modelRun.count({ where: { ...modelWhere, transportKnown: true, transportStartedAt: null, status: "RUNNING" } }),
    prisma.modelRun.count({ where: { ...modelWhere, transportKnown: false } }),
  ]);
  return { limits, period, used: { missions: allMissions - demoMissions, modelCalls, knownModelAttempts, modelReservations, unknownModelAttempts } };
}

const LIMIT_HINT = "这是本部署设置的安全上限，需要调整请联系管理员";

/** 只有部署设置了上限才会拦；缺省不限。 */
export async function assertMissionUsage(organizationId: string) {
  const u = await getUsage(organizationId);
  const { missionsPerMonth, modelCallsPerMonth } = u.limits;
  if (missionsPerMonth !== null && u.used.missions >= missionsPerMonth) {
    throw new UsageLimitError(`本月已接手 ${u.used.missions} 项工作，达到上限 ${missionsPerMonth}。${LIMIT_HINT}`, { metric: "missions", used: u.used.missions, limit: missionsPerMonth });
  }
  if (modelCallsPerMonth !== null && u.used.modelCalls >= modelCallsPerMonth) {
    throw new UsageLimitError(`本月模型调用 ${u.used.modelCalls} 次，达到上限 ${modelCallsPerMonth}。${LIMIT_HINT}`, { metric: "modelCalls", used: u.used.modelCalls, limit: modelCallsPerMonth });
  }
  return u;
}

/**
 * 模型调用配额：原子 check-and-charge（P0-D）
 * ==========================================
 * 此前 modelCallsPerMonth 只在 mission 启动时被 `assertMissionUsage` 检查一次。
 * 但一次 mission 会产生多次模型调用（planner → 各专员 → QA → 综合 → 返工轮），
 * 每次都会写一条 ModelRun。缺口有两层：
 *   ① 299/300 时检查通过，mission 照常启动，内部节点再打十几次 → 直接冲破上限；
 *   ② 多个 mission 并发启动时，各自看到的都是同一个旧计数 → 一起放行。
 *
 * 现在把闸门移到调用获准时（ModelRun 预留落库），并与插入同事务、
 * 在组织级 advisory lock 之后执行，因此：
 *   - 单次 mission 内部的多次调用会被逐次扣减，不会因为「启动时还有余额」而放行到底；
 *   - 并发调用排队执行，先到先得，N 个并发最多放行到上限为止，不多不少。
 *
 * 上限未配置时完全跳过（保持 KX-37「产品内无套餐、不限流」的默认行为）。
 *
 * 与 assertMissionUsage 的分工：后者守「本月还能不能开始新工作」（任务级），
 * 前者守「还能不能再调一次模型」（调用级）。两者都要，因为它们拦在不同事件上。
 */
export async function assertModelCallQuotaTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now = new Date()
) {
  const limit = deploymentLimits().modelCallsPerMonth;
  if (limit === null) return; // 未配置上限 → 不限流
  const period = calendarMonth(now);
  // 本次调用本身还没落库，所以在事务内统计时若已达到上限，说明这一笔就是超限的那一笔。
  const used = await tx.modelRun.count({
    where: { organizationId, createdAt: { gte: period.start, lt: period.end }, ...CHARGED_MODEL_ATTEMPT_WHERE },
  });
  if (used >= limit) {
    throw new UsageLimitError(
      `本月模型调用已达上限 ${limit} 次（每次尝试都计数，含调用失败）。${LIMIT_HINT}`,
      { metric: "modelCalls", used, limit }
    );
  }
}

/**
 * 取得组织级配额锁并原子扣减一次模型调用。
 *
 * 必须在**创建 ModelRun 的同一个事务里**调用：先拿锁、再统计、然后由调用方插入，
 * 三步之间不允许有其他写入插进来，否则计数与插入会脱节。
 *
 * @param createTx 在锁内执行 ModelRun 的插入（由调用方提供，保证与计数同事务）
 */
export async function chargeModelCallInTx<T>(
  tx: Prisma.TransactionClient,
  organizationId: string,
  createTx: () => Promise<T>,
  now = new Date()
): Promise<T> {
  // key 派生沿用 memory 模块的既有约定（src/modules/memory/index.ts:170）：
  // "命名空间:组织id" 交给 Postgres 的 hashtext。不另发明一套哈希，
  // 避免同一组织在不同模块里落到不同的锁上。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"kern-usage-model-calls:" + organizationId}))`;
  await assertModelCallQuotaTx(tx, organizationId, now);
  return createTx();
}

/**
 * 记忆条数上限（可选）。必须与插入在同一事务里、在拿到组织级 advisory lock 之后调用，
 * 并发的“记住”才不会超出。
 */
export async function assertMemoryLimitTx(tx: Prisma.TransactionClient, organizationId: string) {
  const limit = deploymentLimits().memoryItems;
  if (limit === null) return;
  const used = await tx.kernMemory.count({ where: { organizationId, forgottenAt: null } });
  if (used >= limit) {
    throw new UsageLimitError(`已记住 ${used} 条，达到上限 ${limit}，可以先在「记忆」里删掉不再需要的。${LIMIT_HINT}`, { metric: "memoryItems", used, limit });
  }
}
