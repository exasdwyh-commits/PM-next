import { AgentTaskStatus, AutopilotEventStatus } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { listAutomationTraces } from "@/modules/automation-trace";
import { getWorkforceOverview } from "./service";

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

  const attentionItems = [
    ...overview.returnReviews.map((review) => ({
      id: review.id,
      kind: "RETURN_REVIEW" as const,
      title: review.returned.parentTaskGoal || review.goal,
      detail:
        review.returned.resultSummary ||
        review.returned.reason ||
        "专业 Agent 已返回，但没有可读摘要。",
      agentName: review.agent.name,
      updatedAt: review.updatedAt,
      href: "/workforce",
    })),
    ...overview.waitingTasks.map((task) => ({
      id: task.id,
      kind: "WAITING_HUMAN" as const,
      title: task.goal,
      detail: task.blockedReason || "Agent 正在等待人工判断。",
      agentName: task.agent.name,
      updatedAt: task.updatedAt,
      href: task.workItem
        ? "/projects/" + task.workItem.projectId
        : "/workforce",
    })),
    ...recentTraces
      .filter(
        (trace) =>
          trace.createdAt >= since &&
          trace.receipt?.status === AutopilotEventStatus.WAITING_HUMAN
      )
      .map((trace) => ({
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
      })),
  ]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
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
    attentionCount: waitingHumanCount + returnReviewCount + waitingPolicyCount,
    attentionItems,
    recentTraces: recentTraces
      .filter((trace) => trace.createdAt >= since)
      .slice(0, 8),
  };
}

export type WorkforceActivityBrief = Awaited<
  ReturnType<typeof getWorkforceActivityBrief>
>;
