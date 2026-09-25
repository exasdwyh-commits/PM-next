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
  bootstrapDefaultWorkforce,
  createAgentTask,
  finishAgentTask,
  startAgentTask,
} from "@/modules/workforce/service";
import {
  DESKTOP_AGENT_CODE,
  type DesktopAction,
  type DesktopRuntimeResult,
  type DesktopTaskEnvelope,
  describeDesktopAction,
  parseDesktopInstruction,
} from "./contracts";
import {
  noteDesktopPresence,
  readDesktopPresence,
  type DesktopPresence,
} from "./presence";

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

  let agent = await findDesktopAgent(session);
  if (!agent) {
    try {
      await bootstrapDefaultWorkforce(session);
      agent = await findDesktopAgent(session);
    } catch {
      // Non-admin users cannot bootstrap the organization workforce themselves.
      // Keep the error explicit below instead of silently creating a hidden agent.
    }
  }
  if (!agent) {
    throw new ConflictError(
      "Desktop Operator is not initialized. An organization admin must initialize the default workforce once."
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

  // 取任务轮询即心跳：runtime 只要还在跑就会打到这里，不需要单独的 heartbeat 端点。
  noteDesktopPresence({
    organizationId: session.organizationId,
    userId: session.userId,
    deviceId,
  });

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

  const finishedAt = new Date().toISOString();
  const context = asRecord(task.contextSnapshot);
  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      contextSnapshot: {
        ...context,
        desktopResult: {
          ...input.result,
          deviceId: input.deviceId,
          finishedAt,
        },
      } as Prisma.InputJsonValue,
    },
  });

  const conversationId =
    typeof context.desktopConversationId === "string"
      ? context.desktopConversationId
      : null;
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: session.organizationId,
        ownerId: session.userId,
      },
      select: { id: true },
    });
    if (conversation) {
      const statusLabel =
        input.outcome === "SUCCEEDED"
          ? "本机任务已完成"
          : input.outcome === "WAITING_HUMAN"
            ? "本机任务需要你处理"
            : input.outcome === "BLOCKED"
              ? "本机任务被阻断"
              : "本机任务执行失败";
      const output = input.result.output?.trim();
      const body = [
        statusLabel + "：",
        input.result.summary,
        output ? "" : null,
        output ? output.slice(0, 6000) : null,
        output && output.length > 6000
          ? "\n（完整输出已保存在桌面任务回执中）"
          : null,
      ]
        .filter((line): line is string => typeof line === "string")
        .join("\n");

      await prisma.$transaction([
        prisma.message.create({
          data: {
            conversationId,
            role: "ASSISTANT",
            content: body,
            citations: [
              {
                kind: "desktop-task",
                ref: task.id,
                title: statusLabel,
              },
            ] as Prisma.InputJsonValue,
          },
        }),
        prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        }),
      ]);
    }
  }

  return { taskId: task.id, outcome: input.outcome };
}

/* ------------------------------------------------------------------ *
 * 面向用户的本机执行视图
 *
 * 之前 desktop runtime 只有机器对机器的接口：排队、领取、回执全都真实落库，
 * 但产品里没有任何地方能看见它。用户唯一的信号是对话里一句「已发送到队列」，
 * 看不到 Mac 是否连上、任务是否被领取、真实输出和产物是什么。
 * 下面这些读取函数就是把已经存在的真实状态暴露出来，不新增任何执行语义。
 * ------------------------------------------------------------------ */

/** 本机任务在 UI 里的生命周期分组。直接映射 AgentTaskStatus，不做美化。 */
export type DesktopTaskPhase = "WAITING_RUNTIME" | "RUNNING" | "NEEDS_YOU" | "DONE" | "FAILED";

export interface DesktopTaskView {
  taskId: string;
  goal: string;
  status: AgentTaskStatus;
  phase: DesktopTaskPhase;
  /** 动作类别 + 真实参数，供用户复核 Hermes 到底动了什么 */
  action: { tool: string; kind: string; detail: string } | null;
  createdAt: string;
  updatedAt: string;
  conversationId: string | null;
  claim: { deviceId: string; claimedAt: string } | null;
  result: {
    ok: boolean;
    summary: string;
    output: string | null;
    /** 完整输出可能超过对话里的 6000 字截断，这里给出真实长度 */
    outputLength: number;
    artifacts: DesktopRuntimeResult["artifacts"];
    deviceId: string | null;
    finishedAt: string | null;
  } | null;
}

function phaseOf(status: AgentTaskStatus): DesktopTaskPhase {
  switch (status) {
    case AgentTaskStatus.QUEUED:
      return "WAITING_RUNTIME";
    case AgentTaskStatus.RUNNING:
      return "RUNNING";
    case AgentTaskStatus.WAITING_HUMAN:
    case AgentTaskStatus.BLOCKED:
    case AgentTaskStatus.SUBMITTED:
      return "NEEDS_YOU";
    case AgentTaskStatus.SUCCEEDED:
      return "DONE";
    default:
      return "FAILED";
  }
}

function readResult(value: Prisma.JsonValue | null): DesktopTaskView["result"] {
  const raw = asRecord(asRecord(value).desktopResult);
  if (typeof raw.summary !== "string") return null;
  const output = typeof raw.output === "string" ? raw.output : null;
  return {
    ok: raw.ok === true,
    summary: raw.summary,
    output,
    outputLength: output?.length ?? 0,
    artifacts: Array.isArray(raw.artifacts)
      ? (raw.artifacts as DesktopRuntimeResult["artifacts"])
      : undefined,
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null,
  };
}

function toTaskView(task: {
  id: string;
  goal: string;
  status: AgentTaskStatus;
  createdAt: Date;
  updatedAt: Date;
  contextSnapshot: Prisma.JsonValue | null;
}): DesktopTaskView {
  const action = readAction(task.contextSnapshot);
  const claim = readClaim(task.contextSnapshot);
  const context = asRecord(task.contextSnapshot);
  const described = action ? describeDesktopAction(action) : null;
  return {
    taskId: task.id,
    goal: task.goal,
    status: task.status,
    phase: phaseOf(task.status),
    action: action && described ? { tool: action.tool, ...described } : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    conversationId:
      typeof context.desktopConversationId === "string"
        ? context.desktopConversationId
        : null,
    claim: claim ? { deviceId: claim.deviceId, claimedAt: claim.claimedAt } : null,
    result: readResult(task.contextSnapshot),
  };
}

export interface DesktopOverview {
  presence: DesktopPresence;
  /** 已排队但 runtime 还没领取的任务数；presence 不在线时它就是「卡住的工作量」 */
  waitingRuntimeCount: number;
  runningCount: number;
  needsYouCount: number;
  tasks: DesktopTaskView[];
  generatedAt: string;
}

/**
 * 读取当前用户的本机执行全貌。
 * @param input.conversationId 只看某个会话触发的本机任务（对话内运行条用）
 */
export async function getDesktopOverview(
  session: SessionContext,
  input: { conversationId?: string | null; limit?: number } = {}
): Promise<DesktopOverview> {
  const limit = Math.max(1, Math.min(50, input.limit ?? 12));
  const rows = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      agent: { code: DESKTOP_AGENT_CODE },
    },
    orderBy: { createdAt: "desc" },
    // 会话过滤要在 contextSnapshot JSON 上做，先多取一些再在内存里筛，
    // 避免对 JSON 字段写不可移植的查询。
    take: input.conversationId ? Math.max(limit * 4, 40) : limit,
    select: {
      id: true,
      goal: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      contextSnapshot: true,
    },
  });

  const all = rows.map(toTaskView);
  const scoped = input.conversationId
    ? all.filter((t) => t.conversationId === input.conversationId)
    : all;
  const tasks = scoped.slice(0, limit);

  return {
    presence: readDesktopPresence({
      organizationId: session.organizationId,
      userId: session.userId,
    }),
    waitingRuntimeCount: scoped.filter((t) => t.phase === "WAITING_RUNTIME").length,
    runningCount: scoped.filter((t) => t.phase === "RUNNING").length,
    needsYouCount: scoped.filter((t) => t.phase === "NEEDS_YOU").length,
    tasks,
    generatedAt: new Date().toISOString(),
  };
}
