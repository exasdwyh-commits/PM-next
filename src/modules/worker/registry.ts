import type { SessionContext } from "@/modules/identity/session";
import type { ExecutorCommit } from "./claim";
import type { ExecutorStrategy } from "./executor";

/**
 * Worker 处理器注册表（KX-71）。
 *
 * worker 是执行底座（L4）：它只知道「怎么领取任务、怎么幂等、怎么退避、怎么恢复孤儿」，
 * 不知道任务里装的是产品研发专员、Kern 任务节点还是别的什么。具体的处理器由上层
 * （Kern 核心 / 领域）在进程启动时注册进来——见 `@/modules/supervisor/worker-runtime`。
 *
 * 这样 worker 不再 import supervisor / workforce / research / product-rnd，
 * 分层守卫（tests/architecture-layers.test.ts）里的 7 条越界依赖由此归零。
 */

export interface WorkerLifecycleHandlers {
  /** QUEUED → RUNNING，返回本次 run；重复调用应抛 Conflict 而不是双跑。 */
  startAgentTask: (session: SessionContext, taskId: string) => Promise<{ task: unknown; run: { id: string } }>;
  /** RUNNING → 终态，关闭 AgentRun。 */
  finishAgentTask: (
    session: SessionContext,
    taskId: string,
    input: { runId: string; outcome: "SUCCEEDED" | "BLOCKED" | "FAILED"; reason?: string | null; resultSummary?: string; executor?: ExecutorCommit }
  ) => Promise<unknown>;
  /** 把结果带回发起它的对话（失败不应影响任务终态）。 */
  appendConversationReturn: (input: {
    organizationId: string;
    taskId: string;
    runId: string;
    outcome: "SUCCEEDED" | "BLOCKED" | "FAILED";
    summary: string;
  }) => Promise<unknown>;
}

export interface WorkerHandlers {
  /** agentCode → 策略（例如产品研发五路专员）。executorLoop 只领取这些 code 的任务。 */
  strategies: Record<string, ExecutorStrategy>;
  /**
   * 按任务上下文覆盖策略；返回 null/undefined 表示按 `strategies[agentCode]` 走。
   * Kern 任务节点（contextSnapshot.schemaVersion = kern-mission-node/v1）用它接入通用执行器。
   */
  resolveStrategy?: (task: { agentCode: string; contextSnapshot: unknown }) => ExecutorStrategy | null | undefined;
  /** executorLoop 额外领取的任务上下文 schemaVersion（除 strategies 里的 agentCode 之外）。 */
  contextSchemaVersions?: string[];
  lifecycle: WorkerLifecycleHandlers;
  /** researchLoop：RUNNING ResearchRun → 继续推进。缺省则该 loop 空转。 */
  conversations?: {
    runPending: (options: { organizationId?: string; limit?: number }) => Promise<{ scanned: number; acted: number; skipped: number; errors: number; notes?: string[] }>;
    /** 常驻 Worker 用：公平发现 + 预算内启动、不等待完成。 */
    runPendingTick?: (options: { organizationId?: string; limit?: number }) => Promise<{ scanned: number; acted: number; skipped: number; errors: number; notes?: string[] }>;
  };
  research?: { resumeRun: (researchRunId: string) => Promise<unknown> };
  /** reconcileLoop 的产品研发部分。缺省则跳过。 */
  productProgram?: {
    schemaVersion: string;
    advance: (session: SessionContext, parentTaskId: string) => Promise<{ phase: string }>;
    decideAutoRetry: (blockedReason: string | null) => { kind: "RUN" | "WAIT" | "EXHAUSTED" };
    nextAdvanceFailure: (previous: string | null, message: string) => string;
  };
  /** reconcileLoop 的 Kern 任务部分。缺省则跳过。 */
  missions?: {
    listActiveIds: (organizationId: string | undefined, limit: number) => Promise<{ id: string; organizationId: string }[]>;
    advance: (session: SessionContext, missionId: string) => Promise<{ progress: { done: number; total: number } }>;
  };
  /** eventLoop：把一个组织的待派发业务事件发出去，返回派发条数。缺省则该 loop 空转。 */
  events?: {
    dispatchPending: (organizationId: string, options: { workerId: string; limit: number }) => Promise<{ length: number }>;
  };
  /** scheduleLoop：跑到期的定时（简报 / 提醒 / 定期重跑）。缺省则该 loop 空转。 */
  schedules?: {
    runDue: (options: { organizationId?: string; limit?: number }) => Promise<{
      scanned: number;
      results: { id: string; outcome: "LOST_CLAIM" | { status: string; detail?: string | null } }[];
    }>;
  };
}

let current: WorkerHandlers | null = null;

export function registerWorkerHandlers(handlers: WorkerHandlers): void {
  current = handlers;
}

export function hasWorkerHandlers(): boolean {
  return current !== null;
}

export function workerHandlers(): WorkerHandlers {
  if (!current) {
    throw new Error(
      "Worker 处理器未注册：请从 @/modules/supervisor/worker-runtime 导入（它会注册 Kern 的处理器），而不是直接使用 @/modules/worker/loops。"
    );
  }
  return current;
}

export function resetWorkerHandlersForTest(): void {
  current = null;
}
