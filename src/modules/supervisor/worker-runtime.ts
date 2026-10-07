/**
 * Kern 的 Worker 组装点（KX-71）。
 *
 * worker 模块本身不认识任何业务处理器（见 `@/modules/worker/registry`）。
 * 这里把 Kern 需要的处理器注册进去，然后把 worker 的 loop / 进程入口原样导出。
 *
 * 进程入口（scripts/pm-worker.ts）与所有需要跑 loop 的测试都应从本文件导入，
 * 而不是直接 import `@/modules/worker/loops`——否则会得到「处理器未注册」的明确报错。
 */
import { runPendingKernMessages, runPendingKernMessagesTick } from "@/modules/assistant-runtime/message-worker";
import { dispatchPendingBusinessEvents } from "@/modules/business-events";
import { advanceProductRndProgram, decideAutoRetry, nextAdvanceFailure } from "@/modules/product-rnd";
import { EXECUTOR_STRATEGIES } from "@/modules/product-rnd/executor-strategies";
import { resumeResearchRun } from "@/modules/research/research-run";
import { runDueSchedules } from "@/modules/schedule/service";
import { appendAgentTaskConversationReturn } from "@/modules/workforce/conversation-return";
import { finishAgentTask, startAgentTask } from "@/modules/workforce/service";
import { hasWorkerHandlers, registerWorkerHandlers } from "@/modules/worker/registry";
import { MISSION_NODE_SCHEMA, readMissionNodeContext, runMissionNodeAgent } from "./generic-executor";
import { advanceKernMission, listActiveMissionIds } from "./service";

export function registerKernWorkerHandlers(): void {
  registerWorkerHandlers({
    strategies: EXECUTOR_STRATEGIES,
    // Kern 任务节点一律走通用执行器：领域策略绑定的是产品研发上下文（ResearchRun / project），任务节点没有。
    resolveStrategy: (task) => (readMissionNodeContext(task.contextSnapshot) ? runMissionNodeAgent : null),
    contextSchemaVersions: [MISSION_NODE_SCHEMA],
    lifecycle: {
      startAgentTask,
      finishAgentTask,
      appendConversationReturn: appendAgentTaskConversationReturn,
    },
    conversations: { runPending: runPendingKernMessages, runPendingTick: runPendingKernMessagesTick },
    research: { resumeRun: resumeResearchRun },
    productProgram: {
      schemaVersion: "product-rnd-program/v1",
      advance: advanceProductRndProgram,
      decideAutoRetry,
      nextAdvanceFailure,
    },
    missions: {
      listActiveIds: listActiveMissionIds,
      advance: advanceKernMission,
    },
    events: {
      dispatchPending: (organizationId, { workerId, limit }) =>
        dispatchPendingBusinessEvents(organizationId, { workerId, limit, processAutopilot: true }),
    },
    schedules: { runDue: runDueSchedules },
  });
}

if (!hasWorkerHandlers()) registerKernWorkerHandlers();

export * from "@/modules/worker";
export * from "@/modules/worker/loops";
