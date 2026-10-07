import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { isOrgAdmin } from "@/modules/identity/admin";
import { getWorkerHealth } from "@/modules/worker/heartbeat";

/** Read model for the team workspace. Keep prompts, contexts and credentials server-side. */
export async function getWorkforceStudio(session: SessionContext) {
  const admin = await isOrgAdmin(session);
  const [agents, conversationWorker, executorWorker, enabledModelProfiles] = await Promise.all([
    prisma.agent.findMany({
      where: {
        organizationId: session.organizationId,
        ...(admin ? {} : { OR: [{ ownerId: session.userId }, { accessMode: "ORGANIZATION" as const }] }),
      },
      orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
      select: {
        id: true, code: true, name: true, roleKey: true, description: true,
        status: true, modelPolicyKey: true, maxConcurrentTasks: true, accessMode: true,
        skillBindings: {
          where: { enabled: true, skill: { organizationId: session.organizationId, status: "ACTIVE" } },
          select: { skill: { select: { key: true, name: true, allowedTools: true } } },
        },
      },
    }),
    getWorkerHealth(new Date(), { organizationId: session.organizationId, loop: "conversation" }),
    getWorkerHealth(new Date(), { organizationId: session.organizationId, loop: "executor" }),
    prisma.modelProfileConfig.count({ where: { organizationId: session.organizationId, enabled: true } }),
  ]);
  const agentIds = agents.map(agent => agent.id);
  const rows = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId, agentId: { in: agentIds },
      // Sharing an employee does not share another user's personal work.
      ...(admin ? {} : {
        OR: [
          { createdByUserId: session.userId },
          { runs: { some: { userId: session.userId, organizationId: session.organizationId } } },
        ],
      }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 80,
    select: {
      id: true, agentId: true, goal: true, status: true, blockedReason: true, updatedAt: true,
      runs: {
        // A visible task can have runs from different owners. Only expose permitted run summaries.
        where: { organizationId: session.organizationId, ...(admin ? {} : { userId: session.userId }) },
        orderBy: { createdAt: "desc" }, take: 1,
        select: { status: true, outputSummary: true, errorReason: true, conversationId: true, conversation: { select: { ownerId: true } } },
      },
    },
  });
  const taskIds = rows.map(task => task.id);
  const delegations = await prisma.agentDelegation.findMany({
    where: {
      organizationId: session.organizationId,
      fromAgentId: { in: agentIds }, toAgentId: { in: agentIds },
      childTaskId: { in: taskIds },
      OR: [{ parentTaskId: null }, { parentTaskId: { in: taskIds } }],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 20,
    select: { id: true, fromAgentId: true, toAgentId: true, parentTaskId: true, childTaskId: true, reason: true, status: true, updatedAt: true },
  });
  return {
    viewer: { userId: session.userId, organizationId: session.organizationId, name: session.userName },
    generatedAt: new Date().toISOString(),
    workers: { conversation: conversationWorker, executor: executorWorker },
    enabledModelProfiles,
    agents: agents.map(({ skillBindings, ...agent }) => ({
      ...agent,
      skills: skillBindings.map(({ skill }) => ({
        key: skill.key, name: skill.name,
        tools: Array.isArray(skill.allowedTools) ? skill.allowedTools.filter((tool): tool is string => typeof tool === "string") : [],
      })),
    })),
    tasks: rows.map(({ runs, updatedAt, ...task }) => {
      const run = runs[0];
      return {
        ...task, updatedAt: updatedAt.toISOString(),
        summary: run?.outputSummary?.slice(0, 6000) ?? null,
        error: run?.errorReason?.slice(0, 1500) ?? null,
        conversationHref: run?.conversationId && run.conversation?.ownerId === session.userId ? `/muse?c=${run.conversationId}` : null,
      };
    }),
    handoffs: delegations.map(({ updatedAt, ...delegation }) => ({ ...delegation, updatedAt: updatedAt.toISOString() })),
    limits: { tasks: 80, handoffs: 20 },
  };
}

export type WorkforceStudioData = Awaited<ReturnType<typeof getWorkforceStudio>>;
