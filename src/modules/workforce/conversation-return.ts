import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";

type ReturnOutcome = "SUCCEEDED" | "FAILED" | "BLOCKED" | "WAITING_HUMAN";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statusLabel(agentName: string, outcome: ReturnOutcome): string {
  if (outcome === "SUCCEEDED") return `${agentName} 已完成`;
  if (outcome === "BLOCKED") return `${agentName} 被阻断`;
  if (outcome === "WAITING_HUMAN") return `${agentName} 需要你处理`;
  return `${agentName} 执行失败`;
}

/**
 * Append a completed specialist task back to the originating Kern conversation.
 *
 * The target is accepted only when all ownership links agree:
 * organization -> task creator -> conversation owner -> context requestedByUserId.
 * The verified message link and per-run receipt marker make retries idempotent.
 */
export async function appendAgentTaskConversationReturn(input: {
  organizationId: string;
  taskId: string;
  runId: string;
  outcome: ReturnOutcome;
  summary: string;
}) {
  return prisma.$transaction(async (tx) => {
    // The receipt marker lives on AgentTask.contextSnapshot. Lock that row first
    // so concurrent worker retries cannot both observe "no receipt" and append
    // duplicate assistant messages.
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      input.taskId,
      input.organizationId
    );

    const task = await tx.agentTask.findFirst({
      where: {
        id: input.taskId,
        organizationId: input.organizationId,
      },
      include: {
        agent: { select: { code: true, name: true, organizationId: true } },
      },
    });
    if (!task || task.agent.organizationId !== input.organizationId || task.status !== input.outcome) return null;

    const context = asRecord(task.contextSnapshot);
    const target = asRecord(context.kernConversationReturn);
    if (
      target.version !== "kern-conversation-return/v1" ||
      typeof target.conversationId !== "string" ||
      typeof target.requestedByUserId !== "string" ||
      typeof target.agentCode !== "string" ||
      target.agentCode !== task.agent.code ||
      target.requestedByUserId !== task.createdByUserId
    ) {
      return null;
    }

    // A late/wrong callback must not publish another task's run or claim success
    // before commit. Retries are identified by the latest run, not just task id.
    const run = await tx.agentRun.findFirst({
      where: { agentTaskId: task.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const runStatus = input.outcome === "BLOCKED" || input.outcome === "WAITING_HUMAN"
      ? "WAITING_CONFIRMATION" : input.outcome;
    if (!run || run.id !== input.runId || run.organizationId !== input.organizationId ||
        run.agentId !== task.agentId || run.status !== runStatus || !run.finishedAt) return null;

    const conversation = await tx.conversation.findFirst({
      where: {
        id: target.conversationId,
        organizationId: input.organizationId,
        ownerId: task.createdByUserId,
        archivedAt: null,
        owner: { organizationId: input.organizationId, isActive: true, isSystem: false },
      },
      select: { id: true },
    });
    if (!conversation) return null;

    const existingReceipt = asRecord(context.kernConversationReturnReceipt);
    const messageIds = [run.outputMessageId, existingReceipt.messageId]
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const existingMessage = messageIds.length ? await tx.message.findFirst({
      where: { id: { in: messageIds }, runId: run.id, conversationId: conversation.id, role: "ASSISTANT" },
      select: { id: true },
    }) : null;
    if (existingMessage) {
      // Repair legacy/missing run linkage without posting the same receipt twice.
      if (run.outputMessageId !== existingMessage.id) await tx.agentRun.update({
        where: { id: run.id }, data: { outputMessageId: existingMessage.id },
      });
      return { messageId: existingMessage.id, created: false };
    }

    const executorResult = asRecord(context.executorResult);
    const fullOutput =
      input.outcome === "SUCCEEDED" && executorResult.runId === run.id && typeof executorResult.output === "string"
        ? executorResult.output.trim()
        : "";
    const summary = (run.outputSummary?.trim() || run.errorReason?.trim() || task.blockedReason?.trim() || "").slice(0, 4000);
    const output = fullOutput || summary;
    const maxOutput = 12_000;
    const visibleOutput = output.slice(0, maxOutput);
    const label = statusLabel(task.agent.name, input.outcome);
    const content = [
      `Kern 顾问团回执 · ${label}`,
      "",
      visibleOutput || "该任务没有返回可展示文本。",
      output.length > maxOutput
        ? "\n（输出较长，完整结果已保存在 AgentTask 执行回执中。）"
        : null,
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n");

    const createdAt = new Date();
    // Conditional update acquires the conversation row lock before publication.
    // If archive/ownership changed after discovery, do not revive the thread.
    const activeConversation = await tx.conversation.updateMany({
      where: { id: conversation.id, organizationId: input.organizationId, ownerId: task.createdByUserId,
        archivedAt: null, owner: { organizationId: input.organizationId, isActive: true, isSystem: false } },
      data: { updatedAt: createdAt },
    });
    if (activeConversation.count !== 1) return null;
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content,
        runId: input.runId,
        citations: [
          {
            kind: "agent-task",
            ref: task.id,
            title: label,
          },
        ] as Prisma.InputJsonValue,
      },
    });

    const linked = await tx.agentRun.updateMany({
      where: {
        id: input.runId,
        organizationId: input.organizationId,
        agentTaskId: task.id,
        agentId: task.agentId,
        status: runStatus,
        finishedAt: { not: null },
      },
      data: { outputMessageId: message.id },
    });
    if (linked.count !== 1) throw new Error("回执对应的执行已改变，不能提交旧回执");

    await tx.agentTask.update({
      where: { id: task.id },
      data: {
        contextSnapshot: {
          ...context,
          kernConversationReturnReceipt: {
            version: "kern-conversation-return-receipt/v1",
            messageId: message.id,
            runId: run.id,
            conversationId: conversation.id,
            returnedAt: createdAt.toISOString(),
            outcome: input.outcome,
          },
        } as Prisma.InputJsonValue,
      },
    });

    return { messageId: message.id, created: true };
  });
}

export interface ConversationReturnRecoveryResult {
  scanned: number;
  created: number;
  skipped: number;
  errors: number;
}

/**
 * Durable catch-up for the finish → append crash window. AgentTask / AgentRun
 * remain the source of truth; no model/tool execution, new task or second queue.
 * Select only eligible owners and the latest finished run before applying limit,
 * so invalid/deleted targets and already delivered runs cannot starve the batch.
 * Each append revalidates under the same task lock as the immediate path.
 */
export async function recoverAgentTaskConversationReturns(
  options: { organizationId?: string; limit?: number } = {}
): Promise<ConversationReturnRecoveryResult> {
  const organizationId = options.organizationId ?? null;
  const requestedLimit = options.limit ?? 50;
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(0, Math.floor(requestedLimit))) : 50;
  const result: ConversationReturnRecoveryResult = { scanned: 0, created: 0, skipped: 0, errors: 0 };
  if (limit === 0) return result;
  const rows = await prisma.$queryRaw<Array<{ id: string; organizationId: string; runId: string; outcome: ReturnOutcome }>>`
    SELECT t.id, t."organizationId", r.id AS "runId", t.status::text AS outcome
      FROM "AgentTask" t
      JOIN "Agent" a ON a.id = t."agentId" AND a."organizationId" = t."organizationId"
      JOIN "Conversation" c ON c.id = t."contextSnapshot" -> 'kernConversationReturn' ->> 'conversationId'
        AND c."organizationId" = t."organizationId" AND c."ownerId" = t."createdByUserId" AND c."archivedAt" IS NULL
      JOIN "User" u ON u.id = c."ownerId" AND u."organizationId" = t."organizationId" AND u."isActive" AND NOT u."isSystem"
      JOIN LATERAL (
        SELECT ar.* FROM "AgentRun" ar WHERE ar."agentTaskId" = t.id
        ORDER BY ar."createdAt" DESC, ar.id DESC LIMIT 1
      ) r ON r."organizationId" = t."organizationId" AND r."agentId" = t."agentId"
      WHERE (${organizationId}::text IS NULL OR t."organizationId" = ${organizationId})
        AND t.status IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'WAITING_HUMAN')
        AND t."contextSnapshot" -> 'kernConversationReturn' ->> 'version' = 'kern-conversation-return/v1'
        AND t."contextSnapshot" -> 'kernConversationReturn' ->> 'requestedByUserId' = t."createdByUserId"
        AND t."contextSnapshot" -> 'kernConversationReturn' ->> 'agentCode' = a.code
        AND r."finishedAt" IS NOT NULL
        AND r.status::text = CASE WHEN t.status IN ('BLOCKED', 'WAITING_HUMAN') THEN 'WAITING_CONFIRMATION' ELSE t.status::text END
        AND NOT EXISTS (
          SELECT 1 FROM "Message" m WHERE m.id = r."outputMessageId"
            AND m."conversationId" = c.id AND m."runId" = r.id AND m.role = 'ASSISTANT'
        )
      ORDER BY t."updatedAt" ASC, t.id ASC LIMIT ${limit}
  `;
  result.scanned = rows.length;
  for (const row of rows) {
    try {
      const receipt = await appendAgentTaskConversationReturn({
        organizationId: row.organizationId, taskId: row.id, runId: row.runId, outcome: row.outcome, summary: "",
      });
      if (receipt?.created) result.created++;
      else result.skipped++;
    } catch (error) {
      result.errors++;
      console.error(`[pm-worker] 对话回执恢复失败 task=${row.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
