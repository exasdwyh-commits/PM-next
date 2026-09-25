import {
  AgentTaskStatus,
  AgentTriggerType,
  Prisma,
} from "@prisma/client";
import prisma from "@/shared/db";
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import {
  createAgentTask,
  finishAgentTask,
  startAgentTask,
} from "@/modules/workforce/service";
import {
  DESKTOP_AGENT_CODE,
  type DesktopAction,
  type DesktopRuntimeResult,
  type DesktopTaskEnvelope,
  parseDesktopInstruction,
} from "./contracts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readAction(value: Prisma.JsonValue | null): DesktopAction | null {
  const ctx = asRecord(value);
  const action = ctx.desktopAction;
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const tool = (action as Record<string, unknown>).tool;
  return typeof tool === "string" ? (action as DesktopAction) : null;
}

function readClaim(value: Prisma.JsonValue | null): DesktopTaskEnvelope["claim"] {
  const claim = asRecord(asRecord(value).desktopClaim);
  if (
    typeof claim.deviceId !== "string" ||
    typeof claim.runId !== "string" ||
    typeof claim.claimedAt !== "string"
  ) {
    return null;
  }
  return {
    deviceId: claim.deviceId,
    runId: claim.runId,
    claimedAt: claim.claimedAt,
  };
}

function toEnvelope(task: {
  id: string;
  goal: string;
  status: AgentTaskStatus;
  createdAt: Date;
  contextSnapshot: Prisma.JsonValue | null;
}): DesktopTaskEnvelope {
  const action = readAction(task.contextSnapshot);
  if (!action) throw new Error("Desktop task is missing desktopAction");
  return {
    taskId: task.id,
    goal: task.goal,
    action,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    claim: readClaim(task.contextSnapshot),
  };
}

async function findDesktopAgent(session: SessionContext) {
  return prisma.agent.findFirst({
    where: {
      organizationId: session.organizationId,
      code: DESKTOP_AGENT_CODE,
    },
    select: { id: true, code: true, status: true },
  });
}

export async function enqueueDesktopTask(
  session: SessionContext,
  input: { instruction: string; conversationId?: string | null }
) {
  const instruction = input.instruction?.trim();
  if (!instruction) {
    throw new UnprocessableEntityError("Desktop instruction is required");
  }

  const action = parseDesktopInstruction(instruction);
  if (!action) {
    throw new UnprocessableEntityError(
      "Instruction is not recognized as a desktop action"
    );
  }

  const agent = await findDesktopAgent(session);
  if (!agent) {
    throw new ConflictError(
      "Desktop Operator is not initialized. Open Automation Center and initialize the default workforce once."
    );
  }

  const task = await createAgentTask(session, {
    agentId: agent.id,
    goal: instruction,
    contextSnapshot: {
      executionTarget: "DESKTOP",
      desktopAction: action as unknown as Prisma.InputJsonValue,
      desktopConversationId: input.conversationId ?? null,
      requestedByUserId: session.userId,
      requestedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    triggerType: AgentTriggerType.MANUAL,
    triggerRef: input.conversationId
      ? `conversation:${input.conversationId}`
      : "desktop-runtime",
  });

  return { task, action };
}

export async function listDesktopRuntimeTasks(
  session: SessionContext,
  input: { deviceId: string; limit?: number }
): Promise<DesktopTaskEnvelope[]> {
  const deviceId = input.deviceId?.trim();
  if (!deviceId) throw new UnprocessableEntityError("deviceId is required");
  const limit = Math.max(1, Math.min(10, input.limit ?? 3));

  const rows = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      agent: { code: DESKTOP_AGENT_CODE },
      OR: [
        { status: AgentTaskStatus.QUEUED },
        { status: AgentTaskStatus.RUNNING },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 30,
    select: {
      id: true,
      goal: true,
      status: true,
      createdAt: true,
      contextSnapshot: true,
    },
  });

  return rows
    .filter((row) => {
      const action = readAction(row.contextSnapshot);
      if (!action) return false;
      if (row.status === AgentTaskStatus.QUEUED) return true;
      return readClaim(row.contextSnapshot)?.deviceId === deviceId;
    })
    .slice(0, limit)
    .map(toEnvelope);
}

export async function claimDesktopRuntimeTask(
  session: SessionContext,
  input: { taskId: string; deviceId: string }
) {
  const task = await prisma.agentTask.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      organizationId: true,
      createdByUserId: true,
      status: true,
      contextSnapshot: true,
      agent: { select: { code: true } },
    },
  });

  if (
    !task ||
    task.organizationId !== session.organizationId ||
    task.createdByUserId !== session.userId ||
    task.agent.code !== DESKTOP_AGENT_CODE
  ) {
    throw new NotFoundError("Desktop task not found");
  }
  const action = readAction(task.contextSnapshot);
  if (!action) throw new UnprocessableEntityError("Desktop action is missing");

  if (task.status === AgentTaskStatus.RUNNING) {
    const claim = readClaim(task.contextSnapshot);
    if (claim?.deviceId === input.deviceId) {
      return { taskId: task.id, action, runId: claim.runId, resumed: true };
    }
    throw new ConflictError("Desktop task is already claimed by another device");
  }

  if (task.status !== AgentTaskStatus.QUEUED) {
    throw new ConflictError(`Desktop task is ${task.status}, expected QUEUED`);
  }

  const started = await startAgentTask(session, task.id);
  const claimedAt = new Date().toISOString();
  const current = await prisma.agentTask.findUnique({
    where: { id: task.id },
    select: { contextSnapshot: true },
  });
  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      contextSnapshot: {
        ...asRecord(current?.contextSnapshot),
        desktopAction: action as unknown as Prisma.InputJsonValue,
        desktopClaim: {
          deviceId: input.deviceId,
          runId: started.run.id,
          claimedAt,
        },
      } as Prisma.InputJsonValue,
    },
  });

  return {
    taskId: task.id,
    action,
    runId: started.run.id,
    resumed: false,
  };
}

export async function finishDesktopRuntimeTask(
  session: SessionContext,
  input: {
    taskId: string;
    deviceId: string;
    runId: string;
    outcome: "SUCCEEDED" | "FAILED" | "BLOCKED" | "WAITING_HUMAN";
    result: DesktopRuntimeResult;
  }
) {
  const task = await prisma.agentTask.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      organizationId: true,
      createdByUserId: true,
      status: true,
      contextSnapshot: true,
      agent: { select: { code: true } },
    },
  });
  if (
    !task ||
    task.organizationId !== session.organizationId ||
    task.createdByUserId !== session.userId ||
    task.agent.code !== DESKTOP_AGENT_CODE
  ) {
    throw new NotFoundError("Desktop task not found");
  }

  const claim = readClaim(task.contextSnapshot);
  if (
    task.status !== AgentTaskStatus.RUNNING ||
    !claim ||
    claim.deviceId !== input.deviceId ||
    claim.runId !== input.runId
  ) {
    throw new ConflictError("Desktop claim no longer matches this runtime");
  }

  await finishAgentTask(session, task.id, {
    runId: input.runId,
    outcome: input.outcome,
    reason:
      input.outcome === "SUCCEEDED"
        ? undefined
        : input.result.summary.slice(0, 1000),
    resultSummary: input.result.summary.slice(0, 4000),
  });

  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      contextSnapshot: {
        ...asRecord(task.contextSnapshot),
        desktopResult: {
          ...input.result,
          deviceId: input.deviceId,
          finishedAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  });

  return { taskId: task.id, outcome: input.outcome };
}
