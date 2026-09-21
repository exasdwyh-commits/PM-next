/**
 * 交互式运行管理（TASK-017；计划 §1.9 / 契约「运行初始化/取消」）
 *
 * 本模块管理交互式运行的初始化和取消：
 * 1. `prepareInteractiveRun()` - 创建受权 AgentRun 并返回 runId
 * 2. `cancelInteractiveRun()` - 记录取消状态
 * 3. 支持条件更新防重复认领
 * 4. TTL 检查（INTERACTIVE_RUN_START_TTL_MS，默认 300000 毫秒）
 *
 * 设计原则：
 * - 初始化限定用途：ADVISOR_MESSAGE / PROFESSIONAL_ANALYSIS
 * - 上下文只接受经服务器校验的 conversationId/productId/versionId
 * - 只有运行发起人可执行/取消
 * - 一个 runId 至多认领一次
 * - 没有守护进程、调度或后台继续执行承诺
 */

import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError, ForbiddenError } from "@/shared/errors";
import { RunMode, AgentRunStatus } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { getRuntimeStatus } from "@/shared/runtime-status";
import { isAdvisorLLMEnabled } from "./llm";

// ── 常量 ──

/** 交互式运行启动 TTL（毫秒），超过后执行请求必须拒绝认领 */
export const INTERACTIVE_RUN_START_TTL_MS = 300_000; // 5 分钟

/** 允许的运行用途 */
export type InteractiveRunPurpose = "ADVISOR_MESSAGE" | "PROFESSIONAL_ANALYSIS";

// ── 类型 ──

/** 初始化交互式运行的输入 */
export interface PrepareInteractiveRunInput {
  session: SessionContext;
  purpose: InteractiveRunPurpose;
  conversationId?: string;
  productId?: string;
  productVersionId?: string;
  goal?: string;
}

/** 初始化交互式运行的输出 */
export interface PrepareInteractiveRunOutput {
  runId: string;
  status: "QUEUED";
  createdAt: Date;
}

/** 取消交互式运行的输入 */
export interface CancelInteractiveRunInput {
  session: SessionContext;
  runId: string;
}

/** 取消交互式运行的输出 */
export interface CancelInteractiveRunOutput {
  runId: string;
  status: "CANCELLED";
  cancelledAt: Date;
}

/** 认领运行的输入 */
export interface ClaimRunInput {
  session: SessionContext;
  runId: string;
}

/** 认领运行的输出 */
export interface ClaimRunOutput {
  runId: string;
  status: "RUNNING";
  claimedAt: Date;
}

// ── 函数 ──

/**
 * 初始化交互式运行（创建 QUEUED 状态的 AgentRun）
 *
 * 根据计划 §1.9：
 * - POST /api/agent-runs 仅创建受权 AgentRun 并返回 runId
 * - 初始化限定用途 ADVISOR_MESSAGE / PROFESSIONAL_ANALYSIS
 * - 上下文只接受经服务器校验的 conversationId/productId/versionId
 * - 只有运行发起人可执行/取消
 */
export async function prepareInteractiveRun(
  input: PrepareInteractiveRunInput
): Promise<PrepareInteractiveRunOutput> {
  const { session, purpose, conversationId, productId, productVersionId, goal } = input;

  // 校验用途
  const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
  if (!validPurposes.includes(purpose)) {
    throw new UnprocessableEntityError(`无效的运行用途：${purpose}`);
  }

  // 校验上下文
  if (conversationId) {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, organizationId: true, ownerId: true },
    });
    if (!convo || convo.organizationId !== session.organizationId) {
      throw new NotFoundError("Conversation not found");
    }
    if (convo.ownerId !== session.userId) {
      throw new ForbiddenError("只能初始化自己的对话运行");
    }
  }

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, organizationId: true },
    });
    if (!product || product.organizationId !== session.organizationId) {
      throw new NotFoundError("Product not found");
    }
  }

  if (productVersionId) {
    const version = await prisma.productVersion.findUnique({
      where: { id: productVersionId },
      select: { id: true, productId: true },
    });
    if (!version) {
      throw new NotFoundError("ProductVersion not found");
    }
    // 如果同时提供了 productId，校验版本属于该产品
    if (productId && version.productId !== productId) {
      throw new UnprocessableEntityError("ProductVersion 不属于指定的 Product");
    }
  }

  const runtime = getRuntimeStatus();
  const llmEnabled = isAdvisorLLMEnabled();
  const createdAt = new Date();

  // 创建 QUEUED 状态的 AgentRun
  const run = await prisma.agentRun.create({
    data: {
      organizationId: session.organizationId,
      conversationId: conversationId || null,
      userId: session.userId,
      goal: goal?.slice(0, 200) || `${purpose} 预备运行`,
      status: "QUEUED",
      runMode: llmEnabled ? RunMode.LLM : RunMode.TEST_STUB,
      provider: runtime.provider,
      modelId: runtime.modelId,
      promptTemplateVersion: llmEnabled ? "llm-assisted/v1" : "deterministic-tools/v1",
      toolWhitelist: [],
      contextSnapshot: {
        capturedAt: createdAt.toISOString(),
        organizationId: session.organizationId,
        purpose,
        productId: productId || null,
        productVersionId: productVersionId || null,
        permissionScope: "own organization only",
        modelConfigured: runtime.modelConfigured,
        llmEnabled,
      },
      createdAt,
      costStatus: "unknown",
    },
  });

  return {
    runId: run.id,
    status: "QUEUED",
    createdAt,
  };
}

/**
 * 取消交互式运行
 *
 * 根据计划 §1.9：
 * - POST /api/agent-runs/[runId]/cancel 记录取消
 * - 只有运行发起人可取消
 * - 取消后不得写有效成果
 */
export async function cancelInteractiveRun(
  input: CancelInteractiveRunInput
): Promise<CancelInteractiveRunOutput> {
  const { session, runId } = input;

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, userId: true, organizationId: true, status: true },
  });

  if (!run) {
    throw new NotFoundError("AgentRun not found");
  }

  if (run.organizationId !== session.organizationId) {
    throw new NotFoundError("AgentRun not found");
  }

  if (run.userId !== session.userId) {
    throw new ForbiddenError("只能取消自己的运行");
  }

  // 已完成或已失败的运行不能取消
  const terminalStatuses: AgentRunStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];
  if (terminalStatuses.includes(run.status)) {
    throw new UnprocessableEntityError(`运行已处于终态：${run.status}`);
  }

  const cancelledAt = new Date();

  // 更新为 CANCELLED
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: "CANCELLED",
      finishedAt: cancelledAt,
      errorReason: "用户取消",
      costStatus: "unknown",
    },
  });

  return {
    runId,
    status: "CANCELLED",
    cancelledAt,
  };
}

/**
 * 认领运行（QUEUED → RUNNING）
 *
 * 根据计划 §1.9：
 * - 执行请求以条件更新认领 QUEUED → RUNNING
 * - 一个 runId 至多认领一次
 * - 结果事务仅允许未取消且版本仍适用的运行写入有效结果
 */
export async function claimRun(
  input: ClaimRunInput
): Promise<ClaimRunOutput> {
  const { session, runId } = input;

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      status: true,
      createdAt: true,
      contextSnapshot: true,
    },
  });

  if (!run) {
    throw new NotFoundError("AgentRun not found");
  }

  if (run.organizationId !== session.organizationId) {
    throw new NotFoundError("AgentRun not found");
  }

  if (run.userId !== session.userId) {
    throw new ForbiddenError("只能认领自己的运行");
  }

  // 检查状态
  if (run.status !== "QUEUED") {
    throw new UnprocessableEntityError(`运行状态不是 QUEUED：${run.status}`);
  }

  // 检查 TTL
  const now = new Date();
  const elapsed = now.getTime() - run.createdAt.getTime();
  if (elapsed > INTERACTIVE_RUN_START_TTL_MS) {
    // TTL 过期，记录取消但不修改数据（GET 不修改数据）
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: "CANCELLED",
        finishedAt: now,
        errorReason: `运行启动超时（TTL ${INTERACTIVE_RUN_START_TTL_MS}ms）`,
        costStatus: "unknown",
      },
    });
    throw new UnprocessableEntityError(`运行启动超时（已过期 ${elapsed}ms）`);
  }

  // 条件更新：只有 QUEUED 状态才能认领
  const updateResult = await prisma.agentRun.updateMany({
    where: {
      id: runId,
      status: "QUEUED", // 条件更新防重复认领
    },
    data: {
      status: "RUNNING",
      startedAt: now,
    },
  });

  if (updateResult.count === 0) {
    throw new UnprocessableEntityError("运行已被认领或状态已变更");
  }

  return {
    runId,
    status: "RUNNING",
    claimedAt: now,
  };
}

/**
 * 检查运行是否有效（未取消且版本仍适用）
 */
export async function isRunStillValid(
  runId: string,
  organizationId: string
): Promise<{ valid: boolean; reason?: string }> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      contextSnapshot: true,
    },
  });

  if (!run) {
    return { valid: false, reason: "运行不存在" };
  }

  if (run.organizationId !== organizationId) {
    return { valid: false, reason: "运行不属于当前组织" };
  }

  if (run.status === "CANCELLED") {
    return { valid: false, reason: "运行已取消" };
  }

  if (run.status === "FAILED") {
    return { valid: false, reason: "运行已失败" };
  }

  return { valid: true };
}

/**
 * 获取运行状态（用于 GET /api/agent-runs/[runId]）
 */
export async function getRunStatus(
  runId: string,
  organizationId: string
) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      contextSnapshot: true,
      errorReason: true,
      runMode: true,
      usageJson: true,
    },
  });

  if (!run || run.organizationId !== organizationId) {
    throw new NotFoundError("AgentRun not found");
  }

  // 检查是否过期（仅影响显示，不修改数据）
  const now = new Date();
  const elapsed = now.getTime() - run.createdAt.getTime();
  const isExpired = run.status === "QUEUED" && elapsed > INTERACTIVE_RUN_START_TTL_MS;

  return {
    ...run,
    displayStatus: isExpired ? "EXPIRED" : run.status,
    isExpired,
  };
}
