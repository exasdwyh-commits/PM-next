import { AgentTaskStatus, AgentTriggerType, Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { createAgentTask } from "@/modules/workforce/service";
import type { KernDispatchReadiness } from "./dispatch-readiness";

export interface KernSpecialistDispatchResult {
  created: boolean;
  taskId: string;
  agentCode: string;
  status: AgentTaskStatus;
  triggerRef: string;
}

/**
 * Phase 2 minimal AUTO dispatcher.
 *
 * Preconditions are intentionally strict:
 * - dispatch-readiness must already prove a concrete WORKER executor is ready;
 * - exactly one specialist is targeted;
 * - the user message itself is the trigger (MANUAL provenance), not an
 *   autonomous business decision;
 * - no WorkItem / Proposal / Gate / Desktop authority is created here.
 *
 * Replays are deduplicated by the source AgentRun-derived triggerRef.
 */
export async function enqueueKernSpecialistDispatch(input: {
  session: SessionContext;
  conversationId: string;
  sourceRunId: string;
  goal: string;
  readiness: KernDispatchReadiness;
}): Promise<KernSpecialistDispatchResult | null> {
  const { readiness } = input;
  if (
    !readiness.eligible ||
    readiness.state !== "EXECUTOR_READY" ||
    readiness.executor !== "WORKER" ||
    !readiness.agentCode ||
    !readiness.taskClass
  ) {
    return null;
  }

  const agent = await prisma.agent.findFirst({
    where: {
      organizationId: input.session.organizationId,
      code: readiness.agentCode,
      status: "ACTIVE",
    },
    select: { id: true, code: true },
  });
  if (!agent) return null;

  const triggerRef = [
    "kern-conversation",
    input.conversationId,
    "run",
    input.sourceRunId,
    "agent",
    agent.code,
  ].join(":");

  const existing = await prisma.agentTask.findFirst({
    where: {
      organizationId: input.session.organizationId,
      agentId: agent.id,
      triggerRef,
    },
    select: { id: true, status: true },
  });
  if (existing) {
    return {
      created: false,
      taskId: existing.id,
      agentCode: agent.code,
      status: existing.status,
      triggerRef,
    };
  }

  const task = await createAgentTask(input.session, {
    agentId: agent.id,
    goal: input.goal,
    priority: 60,
    triggerType: AgentTriggerType.MANUAL,
    triggerRef,
    contextSnapshot: {
      schemaVersion: "kern-specialist-dispatch/v1",
      kernConversationReturn: {
        version: "kern-conversation-return/v1",
        conversationId: input.conversationId,
        sourceRunId: input.sourceRunId,
        requestedByUserId: input.session.userId,
        agentCode: agent.code,
        taskClass: readiness.taskClass,
      },
      dispatchReadiness: readiness as unknown as Prisma.InputJsonValue,
      requestedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
  });

  return {
    created: true,
    taskId: task.id,
    agentCode: agent.code,
    status: task.status,
    triggerRef,
  };
}
