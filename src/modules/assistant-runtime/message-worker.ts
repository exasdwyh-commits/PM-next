import { randomUUID } from "node:crypto";
import prisma from "@/shared/db";
import { PROCESS_WORKER_ID, isWorkerAlive } from "@/modules/worker/heartbeat";
import { lockRunExecutionTx, watchRunExecution, type RunExecutionGuard } from "@/modules/worker/run-claim";
import { discoverMessageCandidates, markServed } from "@/modules/worker/fair-queue";
import { launchWithBudget } from "@/modules/worker/scheduler";
import { sendDepartmentAssistantMessage } from "./service";

/** Claim once under the conversation lock; messages in one conversation stay ordered. */
/**
 * 领取一条消息。`admission` 是**领取边界**上的准入谓词：
 * 事务内首次读取、会话行锁等待都会花时间，其间可能收到停止信号，
 * 因此在紧邻所有权写入（写 RUNNING + executionToken）之前再检查一次。
 * 已经领取的执行照常 drain；未领取的不写任何所有权。
 */
async function claimMessage(runId: string, admission?: () => boolean) {
  return prisma.$transaction(async tx => {
    const candidate = await tx.agentRun.findUnique({ where: { id: runId }, select: { conversationId: true } });
    if (!candidate?.conversationId) return null;
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${candidate.conversationId} FOR UPDATE`;
    const run = await tx.agentRun.findUnique({ where: { id: runId }, include: { user: true, conversation: true } });
    if (!run?.clientMessageId || !run.inputMessageId || run.status !== "QUEUED") return null;
    const first = await tx.agentRun.findFirst({ where: { conversationId: run.conversationId, clientMessageId: { not: null }, status: { in: ["QUEUED", "RUNNING"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, status: true } });
    if (first?.id !== run.id || first.status === "RUNNING") return null;
    if (!run.user.isActive || run.user.isSystem || run.conversation?.ownerId !== run.userId || run.conversation.archivedAt) {
      await tx.agentRun.update({ where: { id: runId }, data: { status: "FAILED", errorReason: "会话已归档或发起人权限发生变化，消息未执行", finishedAt: new Date() } });
      return null;
    }
    if (admission && !admission()) return null; // 领取边界：锁拿到后、写入所有权前
    const token = randomUUID();
    await tx.agentRun.update({ where: { id: runId }, data: { status: "RUNNING", executionToken: token, leaseOwner: PROCESS_WORKER_ID, heartbeatAt: new Date(), startedAt: new Date() } });
    const message = await tx.message.findUniqueOrThrow({ where: { id: run.inputMessageId } });
    return { run, message, token };
  });
}

async function failMessage(guard: RunExecutionGuard, reason: string) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AgentRun" WHERE id = ${guard.runId} FOR UPDATE`;
    const run = await tx.agentRun.findFirst({ where: { id: guard.runId, organizationId: guard.organizationId, executionToken: guard.token, status: "RUNNING" } });
    if (!run?.conversationId) return;
    const text = `这条消息未能完整处理：${reason}\n\n请先核对已产生的结果或操作，再决定是否发送新的请求。`;
    const message = run.outputMessageId
      ? await (async () => {
          const previous = await tx.message.findUniqueOrThrow({ where: { id: run.outputMessageId! } });
          return tx.message.update({ where: { id: previous.id }, data: { content: `${text}\n\n以下内容在中断前生成，尚未完整确认：\n\n${previous.content}` } });
        })()
      : await tx.message.create({ data: { conversationId: run.conversationId, role: "ASSISTANT", runId: run.id, content: text } });
    await tx.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", outputMessageId: message.id, errorReason: reason.slice(0, 1000), finishedAt: new Date(), executionToken: null, leaseOwner: null } });
  });
}

/** Interrupted message execution is closed, never silently replayed across side effects. */
export async function recoverKernMessageExecutions(organizationId?: string) {
  const runs = await prisma.agentRun.findMany({ where: { clientMessageId: { not: null }, status: "RUNNING", ...(organizationId ? { organizationId } : {}) }, orderBy: { startedAt: "asc" }, take: 50 });
  for (const run of runs) {
    if (!run.executionToken || (run.leaseOwner && await isWorkerAlive(run.leaseOwner, run.startedAt))) continue;
    await failMessage({ runId: run.id, organizationId: run.organizationId, userId: run.userId, token: run.executionToken }, "后台执行进程中断；这次请求不会自动重复执行");
  }
}

export async function executeAcceptedKernMessage(runId: string, admission?: () => boolean) {
  const claimed = await claimMessage(runId, admission);
  if (!claimed) return false;
  const { run, message, token } = claimed;
  const guard = { runId, organizationId: run.organizationId, userId: run.userId, token };
  const control = watchRunExecution(guard);
  const session = { userId: run.userId, organizationId: run.organizationId, userEmail: run.user.email, userName: run.user.name };
  try {
    await control.assertActive();
    const result = await sendDepartmentAssistantMessage(session, run.conversationId!, message.content, {
      runId, execution: { guard, inputMessageId: message.id, signal: control.signal, assertActive: control.assertActive },
    });
    await prisma.$transaction(async tx => {
      await lockRunExecutionTx(tx, guard);
      await tx.agentRun.update({ where: { id: runId }, data: { status: result.failed ? "FAILED" : "SUCCEEDED", executionToken: null, leaseOwner: null, finishedAt: new Date(), outputMessageId: result.message.id } });
    });
  } catch (error) {
    await failMessage(guard, error instanceof Error ? error.message : String(error));
  } finally { await control.dispose(); }
  return true;
}

export async function runPendingKernMessages(
  options: { organizationId?: string; limit?: number; admission?: () => boolean } = {}
) {
  await recoverKernMessageExecutions(options.organizationId);
  const runs = await prisma.agentRun.findMany({ where: { status: "QUEUED", clientMessageId: { not: null }, ...(options.organizationId ? { organizationId: options.organizationId } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.max(4, Math.min(50, (options.limit ?? 2) * 4)), select: { id: true } });
  const result = { scanned: runs.length, acted: 0, skipped: 0, errors: 0, notes: [] as string[] };
  for (const run of runs) {
    if (result.acted >= (options.limit ?? 2)) break;
    // 串行路径同样受停止信号约束（once 模式也走这里）。
    if (options.admission && !options.admission()) {
      (result.notes as string[]).push("admission-closed: stop claiming new work");
      break;
    }
    try { if (await executeAcceptedKernMessage(run.id, options.admission)) result.acted++; else result.skipped++; }
    catch (error) { result.errors++; result.notes.push(error instanceof Error ? error.message : String(error)); }
  }
  return result;
}

/**
 * 会话队列的「一轮」：公平发现候选 + 在进程级预算内启动，**不等待**执行完成。
 * 与 executor 共用 scheduler 预算，组织 A 的慢模型在途时 B 的消息仍可并发开跑。
 * 会话锁、发起人权限、幂等（clientMessageId）由 executeAcceptedKernMessage 负责。
 * LoopResult.acted 记的是「已启动」，执行正误以 AgentRun 终态为准。
 *
 * `admission` 返回 false 时不再领取任何新消息：已经领取的仍会正常排空。
 */
export async function runPendingKernMessagesTick(
  options: { organizationId?: string; limit?: number; admission?: () => boolean } = {}
) {
  await recoverKernMessageExecutions(options.organizationId);
  const limit = options.limit ?? 2;
  const candidates = await discoverMessageCandidates(Math.max(4, limit * 4), options.organizationId);
  const result = { scanned: candidates.length, acted: 0, skipped: 0, errors: 0, notes: [] as string[] };
  if (options.admission && !options.admission()) {
    (result.notes as string[]).push("admission-closed: discovery finished after stop");
    return result;
  }
  let launched = 0;
  for (const run of candidates) {
    if (launched >= limit) break;
    // 与 executor 共用同一份「容量 / 准入 / 跟踪 / 归还」语义，见 launchWithBudget。
    const outcome = await launchWithBudget({
      organizationId: run.organizationId,
      admission: options.admission,
      run: (admission) => executeAcceptedKernMessage(run.id, admission),
      onError: (error) => {
        result.errors += 1;
        result.notes.push(error instanceof Error ? error.message : String(error));
      },
    });
    if (!outcome.launched) {
      (result.notes as string[]).push(
        outcome.reason === "total"
          ? "capacity-full: process total reached, defer rest to next tick"
          : outcome.reason === "organization"
            ? `org-saturated: ${run.organizationId.slice(0, 8)} skipped`
            : "admission-closed: stop claiming new work"
      );
      // 与 executor 同一条规则：组织饱和算明确跳过，总量满保留下一轮机会。
      if (outcome.reason === "organization") markServed("conversation", run.organizationId);
      if (outcome.reason !== "organization") break;
      continue;
    }
    markServed("conversation", run.organizationId);
    launched += 1;
    result.acted += 1;
  }
  return result;
}
