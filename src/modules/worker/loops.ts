import {
  AgentTaskStatus,
  BusinessEventStatus,
  ResearchRunStatus,
} from "@prisma/client";
import prisma from "@/shared/db";
import { dispatchPendingBusinessEvents } from "@/modules/business-events";
import { advanceProductRndProgram } from "@/modules/product-rnd";
import { resumeResearchRun } from "@/modules/research/research-run";
import { executeAgentTask, executorStrategyCodes } from "./executor";
import { advanceKernMission, listActiveMissionIds } from "@/modules/supervisor/service";
import { ensureWorkerProjectAccess, resolveWorkerSession } from "./identity";

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

// ---------------------------------------------------------------------------
// 1. executorLoop：QUEUED AgentTask → Digital Employee Executor
// ---------------------------------------------------------------------------

export async function executorLoopOnce(
  options: LoopOptions = {}
): Promise<LoopResult> {
  const limit = options.limit ?? 2;
  const result = emptyResult();
  const codes = executorStrategyCodes();

  const candidates = await prisma.agentTask.findMany({
    where: {
      status: AgentTaskStatus.QUEUED,
      availableAt: { lte: new Date() },
      OR: [
        { agent: { code: { in: codes } } },
        { contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission-node/v1" } },
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
    try {
      const session = await resolveWorkerSession(candidate.organizationId);
      const outcome = await executeAgentTask(session, candidate.id);
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

// ---------------------------------------------------------------------------
// 2. researchLoop：RUNNING ResearchRun → resume + 继续执行 + 自动发布
// ---------------------------------------------------------------------------

export async function researchLoopOnce(
  options: LoopOptions = {}
): Promise<LoopResult> {
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
      await resumeResearchRun(run.id);
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
      const dispatched = await dispatchPendingBusinessEvents(organizationId, {
        workerId: "pm-worker",
        limit,
        processAutopilot: true,
      });
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
          "product-rnd-program/v1"
      );
    })
    .slice(0, limit);
  result.scanned = productRndParents.length;

  for (const parent of productRndParents) {
    try {
      const session = await resolveWorkerSession(parent.organizationId);
      if (parent.workItem) {
        await ensureWorkerProjectAccess(session, parent.workItem.projectId);
      }
      const advanced = await advanceProductRndProgram(session, parent.id);
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
      }
    }
  }

  // Kern missions: recovery sweep (child completion normally advances them).
  const missions = await listActiveMissionIds(options.organizationId, limit);
  for (const mission of missions) {
    try {
      const session = await resolveWorkerSession(mission.organizationId);
      const status = await advanceKernMission(session, mission.id);
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
