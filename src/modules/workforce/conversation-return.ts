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
 * A receipt marker in AgentTask.contextSnapshot makes retries idempotent.
 */
export async function appendAgentTaskConversationReturn(input: {
  organizationId: string;
  taskId: string;
  runId: string;
  outcome: ReturnOutcome;
  summary: string;
}) {
  const task = await prisma.agentTask.findFirst({
    where: {
      id: input.taskId,
      organizationId: input.organizationId,
    },
    include: {
      agent: { select: { code: true, name: true } },
    },
  });
  if (!task) return null;

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

  const existingReceipt = asRecord(context.kernConversationReturnReceipt);
  if (typeof existingReceipt.messageId === "string") {
    return {
      messageId: existingReceipt.messageId,
      created: false,
    };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: target.conversationId,
      organizationId: input.organizationId,
      ownerId: task.createdByUserId,
    },
    select: { id: true },
  });
  if (!conversation) return null;

  const executorResult = asRecord(context.executorResult);
  const fullOutput =
    typeof executorResult.output === "string"
      ? executorResult.output.trim()
      : "";
  const summary = input.summary.trim().slice(0, 4000);
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
  return prisma.$transaction(async (tx) => {
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

    await tx.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: createdAt },
    });

    await tx.agentRun.updateMany({
      where: {
        id: input.runId,
        organizationId: input.organizationId,
        agentTaskId: task.id,
      },
      data: { outputMessageId: message.id },
    });

    await tx.agentTask.update({
      where: { id: task.id },
      data: {
        contextSnapshot: {
          ...context,
          kernConversationReturnReceipt: {
            version: "kern-conversation-return-receipt/v1",
            messageId: message.id,
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
