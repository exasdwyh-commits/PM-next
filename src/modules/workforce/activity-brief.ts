import { AgentTaskStatus, AutopilotEventStatus } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { listAutomationTraces } from "@/modules/automation-trace";
import { getWorkforceOverview } from "./service";
import { planAttention, type AttentionSignal } from "@/modules/attention/engine";

export async function getWorkforceActivityBrief(
  session: SessionContext,
  options: { windowHours?: number } = {}
) {
  const windowHours = Math.max(1, Math.min(options.windowHours ?? 24, 168));
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);

  const [overview, eventRows, recentTraces] = await Promise.all([
    getWorkforceOverview(session),
    prisma.businessEvent.findMany({
      where: {
        organizationId: session.organizationId,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        autopilotReceipt: {
          select: { status: true },
        },
      },
    }),
    listAutomationTraces(session, { limit: 20 }),
  ]);

  const visibleAgentIds = overview.agents.map((agent) => agent.id);
  const [waitingHumanCount, returnReviewCount] = await Promise.all([
    prisma.agentTask.count({
      where: {
        organizationId: session.organizationId,
        agentId: { in: visibleAgentIds },
        status: AgentTaskStatus.WAITING_HUMAN,
        NOT: {
          triggerDecisionRun: {
            is: { decisionKey: "workforce.resume_parent" },
          },
        },
      },
    }),
    prisma.agentTask.count({
      where: {
        organizationId: session.organizationId,
        agentId: { in: visibleAgentIds },
        status: {
          in: [AgentTaskStatus.QUEUED, AgentTaskStatus.WAITING_HUMAN],
        },
        triggerDecisionRun: {
          is: { decisionKey: "workforce.resume_parent" },
        },
      },
    }),
  ]);

  const triggeredCount = eventRows.filter(
    (row) => row.autopilotReceipt?.status === AutopilotEventStatus.TRIGGERED
  ).length;
  const suppressedCount = eventRows.filter(
    (row) => row.autopilotReceipt?.status === AutopilotEventStatus.SUPPRESSED
  ).length;
  const waitingPolicyCount = eventRows.filter(
    (row) => row.autopilotReceipt?.status === AutopilotEventStatus.WAITING_HUMAN
  ).length;
  const failedCount = eventRows.filter(
    (row) => row.autopilotReceipt?.status === AutopilotEventStatus.FAILED
  ).length;

  // Personal-assistant attention budget (Kern Attention Engine v1):
  // returned child results are Kern's internal supervision work, not automatically
  // a human interruption. Keep returnReviewCount separately for Automation Center,
  // but only true WAITING_HUMAN / policy gates (HUMAN_GATE) plus budgeted
  // SURFACE / INTERRUPT items enter the user's attention queue.
  type AttentionItemKind = "WAITING_HUMAN" | "POLICY_WAITING" | "AUTOMATION_FAILED";
  const itemById = new Map<
    string,
    {
      id: string;
      kind: AttentionItemKind;
      title: string;
      detail: string;
      agentName: string;
      updatedAt: Date;
      href: string;
    }
  >();
  const signals: AttentionSignal[] = [];

  for (const task of overview.waitingTasks) {
    const item = {
      id: task.id,
      kind: "WAITING_HUMAN" as const,
      title: task.goal,
      detail: task.blockedReason || "Agent 正在等待人工判断。",
      agentName: task.agent.name,
      updatedAt: task.updatedAt,
      href: task.workItem ? "/projects/" + task.workItem.projectId : "/workforce",
    };
    itemById.set(item.id, item);
    signals.push({
      id: item.id,
      kind: "WAITING_HUMAN",
      title: item.title,
      occurredAt: item.updatedAt,
    });
  }

  for (const trace of recentTraces) {
    if (trace.createdAt < since) continue;
    const status = trace.receipt?.status;
    if (status === AutopilotEventStatus.WAITING_HUMAN) {
      const item = {
        id: trace.id,
        kind: "POLICY_WAITING" as const,
        title: "Autopilot 等待人工：" + trace.eventType,
        detail:
          trace.decision?.policyReasons.join("、") ||
          trace.receipt?.suppressionReason ||
          "策略门要求人工判断。",
        agentName: "Kern Policy Gate",
        updatedAt: trace.createdAt,
        href: "/workforce",
      };
      itemById.set(item.id, item);
      signals.push({ id: item.id, kind: "POLICY_GATE", title: item.title, occurredAt: item.updatedAt });
    } else if (status === AutopilotEventStatus.FAILED) {
      const item = {
        id: trace.id,
        kind: "AUTOMATION_FAILED" as const,
        title: "自动化失败：" + trace.eventType,
        detail: trace.receipt?.suppressionReason || "自动化执行失败，需要查看原因。",
        agentName: "Kern Autopilot",
        updatedAt: trace.createdAt,
        href: "/workforce",
      };
      itemById.set(item.id, item);
      signals.push({ id: item.id, kind: "TASK_FAILED", title: item.title, occurredAt: item.updatedAt });
    } else if (status === AutopilotEventStatus.SUPPRESSED) {
      signals.push({ id: trace.id, kind: "EVENT_SUPPRESSED", title: trace.eventType, occurredAt: trace.createdAt });
    }
  }

  if (returnReviewCount > 0) {
    signals.push({
      id: "child-return-review",
      kind: "CHILD_RETURN_REVIEW",
      title: `${returnReviewCount} 个子任务回执待 Kern 复核`,
      occurredAt: generatedAt,
    });
  }

  const attentionPlan = planAttention(signals, { now: generatedAt });
  const attentionItems = attentionPlan.visible
    .map((visible) => {
      const item = itemById.get(visible.id);
      return item ? { ...item, level: visible.decision.level } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  return {
    generatedAt: generatedAt.toISOString(),
    since: since.toISOString(),
    windowHours,
    eventCount: eventRows.length,
    triggeredCount,
    suppressedCount,
    waitingPolicyCount,
    failedCount,
    waitingHumanCount,
    returnReviewCount,
    attentionCount: waitingHumanCount + waitingPolicyCount,
    attentionItems,
    attention: {
      version: attentionPlan.version,
      counts: attentionPlan.counts,
      budget: attentionPlan.budget,
    },
    recentTraces: recentTraces
      .filter((trace) => trace.createdAt >= since)
      .slice(0, 8),
  };
}

export type WorkforceActivityBrief = Awaited<
  ReturnType<typeof getWorkforceActivityBrief>
>;
