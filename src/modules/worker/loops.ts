import {
  AgentTaskStatus,
  BusinessEventStatus,
  ResearchRunStatus,
} from "@prisma/client";
import prisma from "@/shared/db";
import { executeAgentTask, executorStrategyCodes } from "./executor";
import { ensureWorkerProjectAccess, resolveWorkerSession } from "./identity";
import { workerHandlers } from "./registry";
import { discoverExecutorCandidates, markServed } from "./fair-queue";
import { launchWithBudget } from "./scheduler";

/**
 * 四个 loop 的单轮实现。
 *
 * 设计约束（评审要求 & 可恢复性）：
 * - **每轮自己判断就绪项**，不依赖上一轮的内存状态 → 单轮幂等，进程随时可被杀；
 * - 单项失败不炸整轮（逐项 try/catch），否则一个坏数据会饿死所有组织；
 * - 不做「一个模块一个定时器」，全部由 index.ts 的统一调度驱动；
 * - `organizationId` 可选：生产默认多组织；测试/单租户部署可收窄范围。
 */

export interface LoopOptions {
  limit?: number;
  organizationId?: string;
  /**
   * 准入谓词：返回 false 表示「已停止领取新工作」（signal / 达到 maxTicks / once 已结束）。
   * 与「取消在途执行」是两回事 —— 这里只阻止**新的**领取，
   * 已经领取的工作必须正常排空。查询可能很慢（分页、锁等待），
   * 因此发现之后、真正领取之前都要再查一次。
   */
  admission?: () => boolean;
}

export interface LoopResult {
  scanned: number;
  acted: number;
  skipped: number;
  errors: number;
  notes?: string[];
}

const emptyResult = (): LoopResult => ({
  scanned: 0,
  acted: 0,
  skipped: 0,
  errors: 0,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// KX-34b：执行前先接管崩溃遗留的孤儿 RUNNING 任务（最多每 30s 扫一次）。
let lastRecoveryAt = 0;
export function resetRecoveryThrottleForTest(): void {
  lastRecoveryAt = 0;
}
async function recoverOrphansThrottled(organizationId: string | undefined, result: LoopResult): Promise<void> {
  if (Date.now() - lastRecoveryAt < 30_000) return;
  lastRecoveryAt = Date.now();
  try {
    const { recoverOrphanedTasks } = await import("./recovery");
    const r = await recoverOrphanedTasks({ organizationId });
    if (r.requeued.length || r.failed.length) {
      (result.notes ??= []).push(`recovered requeued=${r.requeued.length} failed=${r.failed.length}`);
    }
  } catch (error) {
    result.errors += 1;
    (result.notes ??= []).push(`recovery: ${errorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// 0. scheduleLoop（KX-34）：到期的定时 → 简报 / 提醒 / 启动工作
// ---------------------------------------------------------------------------

export async function scheduleLoopOnce(options: LoopOptions = {}): Promise<LoopResult> {
  const result = emptyResult();
  const schedules = workerHandlers().schedules;
  if (!schedules) return result;
  try {
    const r = await schedules.runDue({ organizationId: options.organizationId, limit: options.limit });
    result.scanned = r.scanned;
    const notes: string[] = [];
    for (const item of r.results) {
      if (item.outcome === "LOST_CLAIM" || item.outcome.status === "SKIPPED_EMPTY") result.skipped += 1;
      else if (item.outcome.status === "FAILED") {
        result.errors += 1;
        notes.push(`${item.id}: ${item.outcome.detail ?? "failed"}`);
      } else result.acted += 1;
    }
    if (notes.length) result.notes = notes;
  } catch (error) {
    result.errors += 1;
    result.notes = [errorMessage(error)];
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. executorLoop：QUEUED AgentTask → Digital Employee Executor
// ---------------------------------------------------------------------------

export async function executorLoopOnce(
  options: LoopOptions = {}
): Promise<LoopResult> {
  const limit = options.limit ?? 2;
  const result = emptyResult();
  await recoverOrphansThrottled(options.organizationId, result);
  const codes = executorStrategyCodes();

  const candidates = await prisma.agentTask.findMany({
    where: {
      status: AgentTaskStatus.QUEUED,
      availableAt: { lte: new Date() },
      OR: [
        { agent: { code: { in: codes } } },
        ...(workerHandlers().contextSchemaVersions ?? []).map((schemaVersion) => ({
          contextSnapshot: { path: ["schemaVersion"], equals: schemaVersion },
        })),
      ],
      ...(options.organizationId
        ? { organizationId: options.organizationId }
        : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: { id: true, organizationId: true, agent: { select: { code: true } } },
    // 多取一些：部分候选会被租约/并发上限挡掉，不能因此空转整轮。
    take: Math.max(limit * 4, limit),
  });
  result.scanned = candidates.length;

  for (const candidate of candidates) {
    if (result.acted >= limit) break;
    // 串行路径同样受停止信号约束：每条后续候选领取前都要再查一次准入。
    if (options.admission && !options.admission()) {
      (result.notes ??= []).push("admission-closed: stop claiming new work");
      break;
    }
    try {
      const session = await resolveWorkerSession(candidate.organizationId);
      const outcome = await executeAgentTask(session, candidate.id, options.admission);
      if (outcome.executed) {
        result.acted += 1;
        const detail = outcome.outcome ?? "EXECUTED";
        (result.notes ??= []).push(
          `${candidate.agent.code}:${detail}${outcome.error ? ` (${outcome.error})` : ""}`
        );
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.errors += 1;
      (result.notes ??= []).push(
        `${candidate.agent.code}:ERROR ${errorMessage(error)}`
      );
    }
  }

  return result;
}

/**
 * executor 的「一轮」：公平发现 + 在预算内启动，**不等待**执行完成。
 *
 * 长期执行（等慢模型 HTTP）转由 trackInFlight 跟踪、进程级预算约束；
 * 因此 executor 循环不再被单个慢任务冻结。`executorLoopOnce` 保留
 * 串行 await 语义，供 cron / 测试 / 单次模式复用。
 *
 * LoopResult.acted 记的是「本轮已启动」的任务数；执行完成语义由任务的
 * DB 状态表达（SUCCEEDED/FAILED/BLOCKED），不再并入本函数返回值。
 */
export async function executorLoopTick(
  options: LoopOptions = {}
): Promise<LoopResult> {
  const limit = options.limit ?? 2;
  const result = emptyResult();
  await recoverOrphansThrottled(options.organizationId, result);

  const candidates = await discoverExecutorCandidates(
    Math.max(limit * 4, limit),
    options.organizationId
  );
  result.scanned = candidates.length;
  // 停止信号可能在查询期间到达；此时一条都不许再领。
  if (options.admission && !options.admission()) {
    (result.notes ??= []).push("admission-closed: discovery finished after stop");
    return result;
  }

  let launched = 0;
  for (const candidate of candidates) {
    if (launched >= limit) break;
    // 容量 / 准入 / 跟踪 / 归还槽位的语义只有一份（会话队列共用），见 launchWithBudget。
    const outcome = await launchWithBudget({
      organizationId: candidate.organizationId,
      admission: options.admission,
      run: async (admission) => {
        const session = await resolveWorkerSession(candidate.organizationId);
        // 解析 session 期间可能已收到停止信号：领取边界由 executeAgentTask 自己再查一次。
        if (admission && !admission()) return;
        await executeAgentTask(session, candidate.id, admission);
      },
      onError: (error) => {
        result.errors += 1;
        (result.notes ??= []).push(`${candidate.agent.code}:ERROR ${errorMessage(error)}`);
      },
    });
    if (!outcome.launched) {
      (result.notes ??= []).push(
        outcome.reason === "total"
          ? "capacity-full: process total reached, defer rest to next tick"
          : outcome.reason === "organization"
            ? `org-saturated: ${candidate.organizationId.slice(0, 8)} skipped`
            : "admission-closed: stop claiming new work"
      );
      // 只有总量满或已停止才停扫；组织饱和只是跳过，继续找别的组织。
      // 服务游标：组织饱和算「明确跳过」，可以推进；总量满**不推进** ——
      // 那只是这一轮没排上，它必须保留下一轮的机会（小容量下每轮都推进
      // 会变成固定步长跳过，一半组织永远轮不到）。
      if (outcome.reason === "organization") markServed("executor", candidate.organizationId);
      if (outcome.reason !== "organization") break;
      continue;
    }
    markServed("executor", candidate.organizationId);
    launched += 1;
    result.acted += 1;
    (result.notes ??= []).push(`${candidate.agent.code}: launched`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2. researchLoop：RUNNING ResearchRun → resume + 继续执行 + 自动发布
// ---------------------------------------------------------------------------

export async function researchLoopOnce(
  options: LoopOptions = {}
): Promise<LoopResult> {
  const research = workerHandlers().research;
  if (!research) return emptyResult();
  const limit = options.limit ?? 5;
  const result = emptyResult();

  const runs = await prisma.researchRun.findMany({
    where: {
      status: ResearchRunStatus.RUNNING,
      updatedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
      ...(options.organizationId
        ? { project: { organizationId: options.organizationId } }
        : {}),
    },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
    take: limit,
  });
  result.scanned = runs.length;

  for (const run of runs) {
    try {
      // resume 会接管跨进程遗留的 RUNNING 任务，然后继续跑队列并自动发布。
      await research.resumeRun(run.id);
      const after = await prisma.researchRun.findUnique({
        where: { id: run.id },
        select: { status: true },
      });
      if (after?.status === ResearchRunStatus.PUBLISHED) {
        result.acted += 1;
        (result.notes ??= []).push(`research:${run.id.slice(0, 8)}=PUBLISHED`);
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.errors += 1;
      (result.notes ??= []).push(
        `research:${run.id.slice(0, 8)} ERROR ${errorMessage(error)}`
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. eventLoop：drain BusinessEvent outbox（复用既有 lease/attempt/maxAttempts）
// ---------------------------------------------------------------------------

export async function eventLoopOnce(
  options: LoopOptions = {}
): Promise<LoopResult> {
  const limit = options.limit ?? 20;
  const result = emptyResult();
  const events = workerHandlers().events;
  if (!events) return result;

  const organizations = options.organizationId
    ? [{ organizationId: options.organizationId }]
    : await prisma.businessEvent.findMany({
        where: {
          status: {
            in: [BusinessEventStatus.PENDING, BusinessEventStatus.FAILED],
          },
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: new Date() } },
          ],
        },
        distinct: ["organizationId"],
        select: { organizationId: true },
        take: 10,
      });

  for (const { organizationId } of organizations) {
    try {
      const dispatched = await events.dispatchPending(organizationId, { workerId: "pm-worker", limit });
      result.scanned += dispatched.length;
      result.acted += dispatched.length;
    } catch (error) {
      result.errors += 1;
      (result.notes ??= []).push(
        `events:${organizationId.slice(0, 8)} ERROR ${errorMessage(error)}`
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. reconcileLoop：活跃 Product R&D 主任务 → advance（排队 QA / 合成报告 / 收尾）
// ---------------------------------------------------------------------------

export async function reconcileLoopOnce(
  options: LoopOptions = {}
): Promise<LoopResult> {
  const { productProgram: program, missions } = workerHandlers();
  const limit = options.limit ?? 10;
  const result = emptyResult();

  const parents = await prisma.agentTask.findMany({
    where: {
      parentTaskId: null,
      status: {
        notIn: [
          AgentTaskStatus.SUCCEEDED,
          AgentTaskStatus.FAILED,
          AgentTaskStatus.CANCELLED,
        ],
      },
      ...(options.organizationId
        ? { organizationId: options.organizationId }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      organizationId: true,
      contextSnapshot: true,
      blockedReason: true,
      workItem: { select: { projectId: true } },
    },
    take: limit * 3,
  });

  const productRndParents = parents
    .filter((parent) => {
      const context = parent.contextSnapshot;
      return (
        context !== null &&
        typeof context === "object" &&
        !Array.isArray(context) &&
        (context as Record<string, unknown>).schemaVersion ===
          (program?.schemaVersion ?? "")
      );
    })
    .slice(0, limit);
  result.scanned = productRndParents.length;

  for (const parent of program ? productRndParents : []) {
    // KX-05：上次自动推进失败的，按退避等待；连续失败到上限后停手，等人在界面上重试。
    const decision = program!.decideAutoRetry(parent.blockedReason);
    if (decision.kind !== "RUN") {
      result.skipped += 1;
      (result.notes ??= []).push(
        `reconcile:${parent.id.slice(0, 8)}=${decision.kind === "WAIT" ? "BACKOFF" : "EXHAUSTED"}`
      );
      continue;
    }
    try {
      const session = await resolveWorkerSession(parent.organizationId);
      if (parent.workItem) {
        await ensureWorkerProjectAccess(session, parent.workItem.projectId);
      }
      const advanced = await program!.advance(session, parent.id);
      result.acted += 1;
      (result.notes ??= []).push(
        `reconcile:${parent.id.slice(0, 8)}=${advanced.phase}`
      );
    } catch (error) {
      // advance 在「专家还在跑」「ResearchRun 未发布」等正常中间态会抛 Conflict，
      // 属于预期噪声：记 note 但不计入 errors。
      const message = errorMessage(error);
      if (/still active|missing specialist|not found/i.test(message)) {
        result.skipped += 1;
        (result.notes ??= []).push(`reconcile:${parent.id.slice(0, 8)}=WAITING`);
      } else {
        result.errors += 1;
        (result.notes ??= []).push(
          `reconcile:${parent.id.slice(0, 8)} ERROR ${message}`
        );
        await prisma.agentTask
          .updateMany({
            where: { id: parent.id, status: AgentTaskStatus.RUNNING },
            data: { blockedReason: program!.nextAdvanceFailure(parent.blockedReason, message) },
          })
          .catch(() => null);
      }
    }
  }

  // Kern missions: recovery sweep (child completion normally advances them).
  const activeMissions = missions ? await missions.listActiveIds(options.organizationId, limit) : [];
  for (const mission of activeMissions) {
    try {
      const session = await resolveWorkerSession(mission.organizationId);
      const status = await missions!.advance(session, mission.id);
      result.scanned += 1;
      result.acted += 1;
      (result.notes ??= []).push(
        `mission:${mission.id.slice(0, 8)}=${status.progress.done}/${status.progress.total}`
      );
    } catch (error) {
      result.errors += 1;
      (result.notes ??= []).push(`mission:${mission.id.slice(0, 8)} ERROR ${errorMessage(error)}`);
    }
  }

  return result;
}
