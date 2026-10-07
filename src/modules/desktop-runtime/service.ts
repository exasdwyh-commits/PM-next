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
  ApprovalService,
  type ApprovalGrantStore,
} from "@/modules/governance/approval-service";
import {
  DESKTOP_GRANT_TTL_MS,
  classifyDesktopAction,
  desktopActionHash,
  desktopGrantScope,
  readDesktopConfirmation,
  type DesktopConfirmationState,
} from "./confirmation";
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

  // KX-35：服务端分级。危险命令不入队；需确认的动作先停在 WAITING_HUMAN。
  const decision = classifyDesktopAction(action);
  if (decision.policy === "DENY") {
    throw new UnprocessableEntityError(`危险命令已拒绝执行：${decision.reason}`);
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

  if (decision.policy === "CONFIRM") {
    const confirmation: DesktopConfirmationState = {
      policy: "CONFIRM",
      reason: decision.reason ?? "执行前需要你确认",
      actionHash: desktopActionHash(action),
      requestedAt: new Date().toISOString(),
      status: "PENDING",
      grantId: null,
      decidedAt: null,
      decidedByUserId: null,
    };
    const waiting = await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.WAITING_HUMAN,
        contextSnapshot: {
          ...asRecord(task.contextSnapshot),
          desktopConfirmation: confirmation as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
    return { task: waiting, action, confirmation };
  }

  return { task, action, confirmation: null };
}

/** 审批服务需要 PM_OS_APPROVAL_HMAC_SECRET；未配置时为 null（需确认的动作一律无法放行，不会误放行）。 */
export function desktopApprovalService(store?: ApprovalGrantStore): ApprovalService | null {
  try {
    return store ? new ApprovalService(store) : new ApprovalService();
  } catch {
    return null;
  }
}

/**
 * KX-35 确认卡：允许一次 / 不允许。
 * - 门禁同 claim：同组织 + 同发起人 + Desktop Operator，任一不符 404。
 * - 只接受「待确认」的任务（WAITING_HUMAN + desktopConfirmation.PENDING），否则 409。
 * - ALLOW：签发绑定 actionHash 的单次 ApprovalGrant，任务回到 QUEUED 等执行端领取。
 * - DENY：任务 CANCELLED，结果写明「你没有允许」。
 */
export async function confirmDesktopTask(
  session: SessionContext,
  input: { taskId: string; decision: "ALLOW" | "DENY" },
  deps: { approvals?: ApprovalService | null } = {}
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
  const confirmation = readDesktopConfirmation(task.contextSnapshot);
  if (
    !action ||
    !confirmation ||
    confirmation.status !== "PENDING" ||
    task.status !== AgentTaskStatus.WAITING_HUMAN
  ) {
    throw new ConflictError("这项本机任务当前不在等待确认");
  }
  // 快照里的动作被改过（指纹不符）就不允许按旧确认放行。
  if (desktopActionHash(action) !== confirmation.actionHash) {
    throw new ConflictError("本机动作与确认时的指纹不一致，请重新发起");
  }

  const now = new Date();
  const base = asRecord(task.contextSnapshot);
  if (input.decision === "DENY") {
    const updated = await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.CANCELLED,
        completedAt: now,
        contextSnapshot: {
          ...base,
          desktopConfirmation: {
            ...confirmation,
            status: "DENIED",
            decidedAt: now.toISOString(),
            decidedByUserId: session.userId,
          } as unknown as Prisma.InputJsonValue,
          desktopResult: {
            ok: false,
            summary: "你没有允许执行，这项本机任务已取消。",
            output: null,
            finishedAt: now.toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
      select: { id: true, status: true },
    });
    return { taskId: updated.id, status: updated.status, decision: "DENY" as const, grantId: null };
  }

  const approvals = deps.approvals === undefined ? desktopApprovalService() : deps.approvals;
  if (!approvals) {
    throw new ConflictError("审批签名密钥未配置（PM_OS_APPROVAL_HMAC_SECRET），暂时无法放行需确认的本机动作");
  }
  const scope = desktopGrantScope(task.id, action);
  const grant = await approvals.issue(
    session,
    { ...scope, validUntil: new Date(now.getTime() + DESKTOP_GRANT_TTL_MS), channel: "desktop-confirm" },
    now
  );
  // 只在仍是 WAITING_HUMAN 时回到队列，防止并发的第二次点击重复放行。
  const moved = await prisma.agentTask.updateMany({
    where: { id: task.id, status: AgentTaskStatus.WAITING_HUMAN },
    data: {
      status: AgentTaskStatus.QUEUED,
      contextSnapshot: {
        ...base,
        desktopConfirmation: {
          ...confirmation,
          status: "APPROVED",
          grantId: grant.id,
          decidedAt: now.toISOString(),
          decidedByUserId: session.userId,
        } as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonValue,
    },
  });
  if (moved.count !== 1) throw new ConflictError("这项本机任务已被处理");
  return { taskId: task.id, status: AgentTaskStatus.QUEUED, decision: "ALLOW" as const, grantId: grant.id };
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
  input: { taskId: string; deviceId: string },
  deps: { approvals?: ApprovalService | null } = {}
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

  // KX-35：需确认的动作必须持有已批准、未用过、指纹一致的单次 ApprovalGrant，领取即消耗。
  const decision = classifyDesktopAction(action);
  if (decision.policy === "DENY") {
    throw new ConflictError("危险命令不允许在本机执行");
  }
  const confirmation = decision.policy === "CONFIRM" ? readDesktopConfirmation(task.contextSnapshot) : null;
  const approvals =
    decision.policy === "CONFIRM" ? (deps.approvals === undefined ? desktopApprovalService() : deps.approvals) : null;
  if (decision.policy === "CONFIRM") {
    if (!confirmation || confirmation.status !== "APPROVED" || !confirmation.grantId) {
      throw new ConflictError("这项本机任务还没有得到你的确认");
    }
    if (!approvals) throw new ConflictError("审批签名密钥未配置，无法核验确认凭据");
  }

  // 先启动（含并发 / 状态校验）再消耗凭据：启动失败时凭据原样保留，不会出现
  // 「凭据已作废、任务却卡在 QUEUED」的死局。
  const started = await startAgentTask(session, task.id);
  if (decision.policy === "CONFIRM" && confirmation && approvals) {
    try {
      await approvals.consume(confirmation.grantId!, {
        organizationId: session.organizationId,
        ...desktopGrantScope(task.id, action),
        runId: started.run.id,
      });
    } catch (error) {
      // 凭据无效 / 已用 / 过期 / 动作被改：撤销这次运行，任务退回「等你确认」。
      // 动作被改的情况下重新确认会因指纹不符再次被拒，不会放行篡改后的命令。
      await prisma.$transaction([
        prisma.agentRun.update({ where: { id: started.run.id }, data: { status: "CANCELLED" } }),
        prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.WAITING_HUMAN,
            startedAt: null,
            contextSnapshot: {
              ...asRecord(task.contextSnapshot),
              desktopConfirmation: {
                ...confirmation,
                status: "PENDING",
                grantId: null,
                decidedAt: null,
                decidedByUserId: null,
              } as unknown as Prisma.InputJsonValue,
            } as Prisma.InputJsonValue,
          },
        }),
      ]);
      const used = error instanceof Error && error.message === "approval-grant-already-consumed";
      throw new ConflictError(used ? "确认凭据已被使用过，需要重新确认" : "确认凭据无效或已过期，需要重新确认");
    }
  }
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
  /** 动作的中文说明 + 真实参数，供用户复核 Hermes 到底动了什么（label 已是展示文案，不是枚举） */
  action: { tool: string; label: string; detail: string } | null;
  createdAt: string;
  updatedAt: string;
  conversationId: string | null;
  claim: { deviceId: string; claimedAt: string } | null;
  /** KX-35：等你确认的本机动作（只有 PENDING 时非 null） */
  confirmation: { reason: string; requestedAt: string } | null;
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
    action: action && described ? { tool: action.tool, label: described.kind, detail: described.detail } : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    conversationId:
      typeof context.desktopConversationId === "string"
        ? context.desktopConversationId
        : null,
    claim: claim ? { deviceId: claim.deviceId, claimedAt: claim.claimedAt } : null,
    confirmation: (() => {
      const c = readDesktopConfirmation(task.contextSnapshot);
      return c && c.status === "PENDING" && task.status === AgentTaskStatus.WAITING_HUMAN
        ? { reason: c.reason, requestedAt: c.requestedAt }
        : null;
    })(),
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
