import { AgentTaskStatus } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { ModelExecutionBudgetError } from "@/modules/model-gateway/runtime";
import { UsageLimitError } from "@/modules/usage";
import { MAX_EXECUTOR_ATTEMPTS, backoffForAttempt } from "./backoff";
import {
  claimAgentTaskForExecution,
  releaseAgentTaskClaim,
  ExecutionStoppedError,
} from "./claim";
import { watchExecution } from "./execution-control";
import { ensureWorkerProjectAccess } from "./identity";
import { workerHandlers } from "./registry";

/**
 * Digital Employee Executor
 * =========================
 *
 * 「数字员工自己干活」的执行层。核心立场（与评审一致）：
 *
 * **确定性优先，诚实缺省优先，Muse 只做摘要增强。**
 *
 * 五个 specialist 的产出必须是可审计的结构化数据。没有真实数据支撑的结论
 * （成本 BOM、配方规格）**必须快速 BLOCKED + 精确 missingInputs**，把缺口写进
 * DataGap 让报告 unknowns 呈现出来——而不是让模型编一个看起来专业的数字。
 * 这与系统既有的 UNKNOWN 保留哲学是同一条原则。
 *
 * 本模块不做的事（硬边界）：
 * - 不写 Verifier / Gate / ToolBroker / Approval；
 * - 不把 claim 标成 VERIFIED（证据核验链路的职责）；
 * - 不改其它 AgentTask / WorkItem / Project；
 * - 不改 AgentTask 表结构（状态与进度都放 contextSnapshot，避免迁移）。
 */

export type ExecutorOutcomeKind = "SUCCEEDED" | "BLOCKED";

export interface ExecutorDataGap {
  fieldKey: string;
  fieldName: string;
  description: string;
}

export interface ExecutorOutcome {
  kind: ExecutorOutcomeKind;
  /** 写入 AgentRun.outputSummary，会直接出现在管理报告的 advisoryNotes 里。 */
  summary: string;
  /** BLOCKED 时写任务 blockedReason。 */
  reason?: string;
  result: Record<string, unknown>;
  dataGaps?: ExecutorDataGap[];
}

export interface ExecutorContext {
  session: SessionContext;
  task: {
    id: string;
    goal: string;
    organizationId: string;
    parentTaskId: string | null;
    workItemId: string | null;
    projectId: string | null;
    agentCode: string;
    runId: string;
    attempt: number;
  };
  /** parent 任务的 contextSnapshot（例如 researchRunId）。 */
  parentContext: Record<string, unknown>;
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
  leaseToken?: string;
}

export type ExecutorStrategy = (
  context: ExecutorContext
) => Promise<ExecutorOutcome>;

export function honestBlocked(input: {
  summary: string;
  reason: string;
  missingInputs: string[];
  dataGaps: ExecutorDataGap[];
  extra?: Record<string, unknown>;
}): ExecutorOutcome {
  return {
    kind: "BLOCKED",
    summary: input.summary,
    reason: input.reason,
    result: {
      kind: "HONEST_BLOCKED",
      missingInputs: input.missingInputs,
      ...(input.extra ?? {}),
    },
    dataGaps: input.dataGaps,
  };
}


// ---------------------------------------------------------------------------
// 执行入口
// ---------------------------------------------------------------------------

/** 已注册处理器的 agentCode 列表（executorLoop 据此领取任务）。 */
export function executorStrategyCodes(): string[] {
  return Object.keys(workerHandlers().strategies);
}

export function hasExecutorStrategy(agentCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(workerHandlers().strategies, agentCode);
}

export interface ExecuteAgentTaskResult {
  executed: boolean;
  /** 未执行的机器可读原因：lease-held / not-found / status-X / no-strategy / start-conflict。 */
  skippedReason?: string;
  outcome?: ExecutorOutcomeKind | "FAILED" | "CANCELLED";
  error?: string;
}

/**
 * 执行一个 AgentTask（QUEUED → 终态）。
 *
 * 幂等性来源：
 * - executorLease CAS 保证同一时刻只有一个执行者；
 * - `startAgentTask` 自身要求 status=QUEUED（重复调用会 ConflictError 而不是双跑）。
 */
/**
 * 执行一个已领取候选。
 *
 * `admission` 是**领取边界**上的准入谓词：内部读取、权限检查都会花时间，
 * 其间可能收到停止信号。只在函数入口检查是不够的 —— 那时还没写入任何所有权，
 * 但真正的租约领取（`claimAgentTaskForExecution`）发生在内部读取之后。
 * 因此在**紧邻领取之前**再检查一次：已关闭就不领取、不消耗重试额度，
 * 由调用方归还预算槽位。已经领取的执行照常 drain。
 */
export async function executeAgentTask(
  session: SessionContext,
  taskId: string,
  admission?: () => boolean
): Promise<ExecuteAgentTaskResult> {
  const task = await prisma.agentTask.findUnique({
    where: { id: taskId },
    include: {
      agent: { select: { code: true } },
      workItem: { select: { id: true, projectId: true } },
      parentTask: { select: { id: true, contextSnapshot: true } },
    },
  });
  if (!task || task.organizationId !== session.organizationId) {
    return { executed: false, skippedReason: "not-found" };
  }
  if (task.status !== AgentTaskStatus.QUEUED) {
    return { executed: false, skippedReason: `status-${task.status}` };
  }

  const handlers = workerHandlers();
  const strategy =
    handlers.resolveStrategy?.({ agentCode: task.agent.code, contextSnapshot: task.contextSnapshot }) ??
    handlers.strategies[task.agent.code];
  if (!strategy) {
    return { executed: false, skippedReason: "no-strategy" };
  }

  if (task.workItem) {
    await ensureWorkerProjectAccess(session, task.workItem.projectId);
  }

  // 领取边界：内部读取与权限检查期间可能已收到停止信号，此时不得再写入租约。
  if (admission && !admission()) {
    return { executed: false, skippedReason: "admission-closed" };
  }

  const token = await claimAgentTaskForExecution(taskId, session.organizationId);
  if (!token) {
    return { executed: false, skippedReason: "lease-held" };
  }

  const executorState = readExecutorState(task.contextSnapshot);
  const priorAttempts = Number(executorState.attempts ?? 0);

  let started: { task: unknown; run: { id: string } };
  try {
    started = await handlers.lifecycle.startAgentTask(session, taskId);
  } catch (error) {
    // 典型场景：agent 并发上限已满 / availableAt 还没到 / 状态被别处改掉。
    // 这些都不是「执行失败」，不该计入重试次数——直接释放租约等下一轮。
    await releaseAgentTaskClaim(taskId, session.organizationId, token);
    const message = error instanceof Error ? error.message : String(error);
    return { executed: false, skippedReason: `start-conflict: ${message}` };
  }

  const guard = { taskId: task.id, organizationId: session.organizationId, token, runId: started.run.id };
  const control = watchExecution(guard);
  const returnToConversation = (outcome: "SUCCEEDED" | "BLOCKED" | "FAILED", summary: string) =>
    handlers.lifecycle.appendConversationReturn({ organizationId: task.organizationId, taskId: task.id, runId: started.run.id, outcome, summary })
      .catch((error: unknown) => console.error(`[pm-worker] 对话回执失败 task=${task.id}:`, error instanceof Error ? error.message : error));
  try {
    await control.assertActive();
    const outcome = await strategy({ session, task: {
      id: task.id, goal: task.goal, organizationId: task.organizationId, parentTaskId: task.parentTaskId,
      workItemId: task.workItemId, projectId: task.workItem?.projectId ?? null,
      agentCode: task.agent.code, runId: started.run.id, attempt: priorAttempts + 1,
    }, parentContext: asRecord(task.parentTask?.contextSnapshot), signal: control.signal,
      assertActive: control.assertActive, leaseToken: token });
    await control.assertActive();
    await handlers.lifecycle.finishAgentTask(session, task.id, {
      runId: started.run.id, outcome: outcome.kind, reason: outcome.reason ?? null, resultSummary: outcome.summary,
      executor: { token, dataGaps: outcome.dataGaps,
        result: { ...outcome.result, agentCode: task.agent.code, outcome: outcome.kind, summary: outcome.summary, finishedAt: new Date().toISOString() },
        state: { attempts: priorAttempts + 1, lastError: null, nextRetryAt: null, lastOutcome: outcome.kind, finishedAt: new Date().toISOString() },
      },
    });
    await returnToConversation(outcome.kind, outcome.summary);
    return { executed: true, outcome: outcome.kind };
  } catch (error) {
    if (error instanceof ExecutionStoppedError || control.signal.aborted) return { executed: false, skippedReason: "execution-stopped", outcome: "CANCELLED" };
    const message = error instanceof Error ? error.message : String(error);
    const quota = error instanceof UsageLimitError || error instanceof ModelExecutionBudgetError;
    const attempts = priorAttempts + 1;
    const retryAt = !quota && attempts < MAX_EXECUTOR_ATTEMPTS ? new Date(Date.now() + backoffForAttempt(attempts)) : null;
    try {
      await handlers.lifecycle.finishAgentTask(session, task.id, {
        runId: started.run.id, outcome: quota ? "BLOCKED" : "FAILED", reason: message.slice(0, 1000),
        resultSummary: (quota ? `已被成本闸门拦下（不消耗重试额度）：${message}` : `执行器异常（第 ${attempts} 次）：${message}`).slice(0, 4000),
        executor: { token, retryAt, ...(quota ? {} : { state: { attempts, lastError: message, nextRetryAt: retryAt?.toISOString() ?? null, lastOutcome: "FAILED", finishedAt: new Date().toISOString() } }) },
      });
    } catch (finishError) {
      if (finishError instanceof ExecutionStoppedError) return { executed: false, skippedReason: "execution-stopped", outcome: "CANCELLED" };
      console.error(`[pm-worker] 执行器异常收尾失败 task=${task.id}:`, finishError instanceof Error ? finishError.message : finishError);
      return { executed: true, outcome: "FAILED", error: message };
    }
    if (quota || !retryAt) await returnToConversation(quota ? "BLOCKED" : "FAILED", quota ? `已被成本闸门拦下：${message}`.slice(0, 4000) : `执行器连续 ${attempts} 次失败：${message}`.slice(0, 4000));
    return { executed: true, outcome: quota ? "BLOCKED" : "FAILED", ...(quota ? {} : { error: message }) };
  } finally {
    await control.dispose();
    await releaseAgentTaskClaim(task.id, session.organizationId, token);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readExecutorState(value: unknown): Record<string, unknown> {
  const context = asRecord(value);
  return asRecord(context.executorState);
}
