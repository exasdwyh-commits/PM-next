import {
  AgentLifecycleStatus,
  AgentTaskStatus,
  AgentTriggerType,
  Prisma,
} from "@prisma/client";
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

  const [agent, sourceRun] = await Promise.all([
    prisma.agent.findFirst({
      where: {
        organizationId: input.session.organizationId,
        code: readiness.agentCode,
        status: AgentLifecycleStatus.ACTIVE,
      },
      select: { id: true, code: true },
    }),
    prisma.agentRun.findFirst({
      where: {
        id: input.sourceRunId,
        organizationId: input.session.organizationId,
        userId: input.session.userId,
        conversationId: input.conversationId,
      },
      select: { id: true },
    }),
  ]);
  if (!agent || !sourceRun) return null;

  const triggerRef = [
    "kern-conversation",
    input.conversationId,
    "run",
    input.sourceRunId,
    "agent",
    agent.code,
  ].join(":");

  // Serialize the same source-run/agent dispatch key at the database level.
  // This closes the find-then-create race without adding a migration solely for
  // the Phase 2 pilot. Collisions only serialize unrelated work; they do not
  // change correctness.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${triggerRef}, 0))
    `;

    const existing = await tx.agentTask.findFirst({
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

    // createAgentTask keeps the existing access, audit and governance checks.
    // The advisory lock remains held until this outer transaction finishes, so
    // a concurrent replay cannot pass the existence check.
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
  });
}
