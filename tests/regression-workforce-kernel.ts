import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentAccessMode, AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultAutopilots } from "../src/modules/autopilot";
import { getWorkforceActivityBrief } from "../src/modules/workforce/activity-brief";
import {
  bootstrapDefaultWorkforce,
  createAgentTask,
  delegateAgentTask,
  finishAgentTask,
  getWorkforceOverview,
  resolveReturnedChildReview,
  startAgentTask,
} from "../src/modules/workforce/service";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Workforce Test", code: "WF_" + tag },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: "Other Workforce Test", code: "WF_OTHER_" + tag },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "wf-admin-" + tag + "@hermes.test",
      name: "Workforce Admin",
    },
  });
  const member = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "wf-member-" + tag + "@hermes.test",
      name: "Workforce Member",
    },
  });
  const outsider = await prisma.user.create({
    data: {
      organizationId: otherOrg.id,
      email: "wf-outsider-" + tag + "@hermes.test",
      name: "Other Org User",
    },
  });

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN },
      { organizationId: org.id, userId: member.id, role: OrgRole.MEMBER },
      { organizationId: otherOrg.id, userId: outsider.id, role: OrgRole.ORG_ADMIN },
    ],
  });

  const adminSession = {
    userId: admin.id,
    organizationId: org.id,
    userEmail: admin.email,
    userName: admin.name,
  };
  const memberSession = {
    userId: member.id,
    organizationId: org.id,
    userEmail: member.email,
    userName: member.name,
  };
  const outsiderSession = {
    userId: outsider.id,
    organizationId: otherOrg.id,
    userEmail: outsider.email,
    userName: outsider.name,
  };

  try {
    console.log("▶ W1 bootstrap is admin-only and idempotent");
    await assert.rejects(
      bootstrapDefaultWorkforce(memberSession),
      (error: any) => error?.statusCode === 403
    );

    const first = await bootstrapDefaultWorkforce(adminSession);
    await bootstrapDefaultWorkforce(adminSession);
    await bootstrapDefaultAutopilots(adminSession);

    assert.equal(await prisma.agent.count({ where: { organizationId: org.id } }), 11);
    assert.equal(await prisma.skill.count({ where: { organizationId: org.id } }), 11);
    assert.equal(await prisma.squad.count({ where: { organizationId: org.id } }), 1);
    assert.equal(
      await prisma.squadMember.count({ where: { squadId: first.squad.id } }),
      11
    );
    console.log("  ✔ one stable product squad, eleven agents, eleven skills");

    const hermes = await prisma.agent.findUniqueOrThrow({
      where: {
        organizationId_code: { organizationId: org.id, code: "hermes_pm" },
      },
    });
    const research = await prisma.agent.findUniqueOrThrow({
      where: {
        organizationId_code: { organizationId: org.id, code: "research_agent" },
      },
    });

    console.log("▶ W2 access scope fails closed for OWNER_ONLY agents");
    const privateAgent = await prisma.agent.create({
      data: {
        organizationId: org.id,
        code: "private_" + tag,
        name: "Private Agent",
        roleKey: "PRIVATE_TEST",
        ownerId: admin.id,
        accessMode: AgentAccessMode.OWNER_ONLY,
      },
    });
    await assert.rejects(
      createAgentTask(memberSession, {
        agentId: privateAgent.id,
        goal: "member must not invoke private agent",
      }),
      (error: any) => error?.statusCode === 404
    );
    const memberOverview = await getWorkforceOverview(memberSession);
    assert.equal(
      memberOverview.agents.some((agent) => agent.id === privateAgent.id),
      false
    );
    const adminPrivateTask = await createAgentTask(adminSession, {
      agentId: privateAgent.id,
      goal: "owner can invoke private agent",
    });
    assert.equal(adminPrivateTask.status, AgentTaskStatus.QUEUED);
    console.log("  ✔ owner-only agent is neither invokable nor visible to other members");

    console.log("▶ W3 agent concurrency is enforced when work starts");
    await prisma.agent.update({
      where: { id: hermes.id },
      data: { maxConcurrentTasks: 1 },
    });
    const parent = await createAgentTask(adminSession, {
      agentId: hermes.id,
      squadId: first.squad.id,
      goal: "Assess product evidence and route missing research",
    });
    const competing = await createAgentTask(adminSession, {
      agentId: hermes.id,
      squadId: first.squad.id,
      goal: "Second Hermes task must remain queued",
    });
    const claims = await Promise.allSettled([
      startAgentTask(adminSession, parent.id),
      startAgentTask(adminSession, competing.id),
    ]);
    assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
    const rejectedClaim = claims.find((result) => result.status === "rejected");
    assert.ok(rejectedClaim && rejectedClaim.status === "rejected");
    assert.equal((rejectedClaim.reason as any)?.statusCode, 409);

    const firstWon = claims[0].status === "fulfilled";
    const runningTask = firstWon ? parent : competing;
    const queuedTask = firstWon ? competing : parent;
    const startedParent =
      claims[0].status === "fulfilled"
        ? claims[0].value
        : claims[1].status === "fulfilled"
          ? claims[1].value
          : null;
    assert.ok(startedParent);
    assert.equal(startedParent.task.status, AgentTaskStatus.RUNNING);
    assert.equal(startedParent.run.agentId, hermes.id);
    assert.equal(startedParent.run.agentTaskId, runningTask.id);

    const queuedReloaded = await prisma.agentTask.findUniqueOrThrow({
      where: { id: queuedTask.id },
    });
    assert.equal(queuedReloaded.status, AgentTaskStatus.QUEUED);
    console.log("  ✔ simultaneous claims serialize on Agent capacity; exactly one wins");

    console.log("▶ W4 delegation creates durable child task and provenance");
    await assert.rejects(
      delegateAgentTask(adminSession, {
        parentTaskId: runningTask.id,
        toAgentId: hermes.id,
        goal: "self delegation must fail",
        reason: "invalid routing",
        sourceRunId: startedParent.run.id,
      }),
      (error: any) => error?.statusCode === 422
    );

    const delegated = await delegateAgentTask(adminSession, {
      parentTaskId: runningTask.id,
      toAgentId: research.id,
      goal: "Find and verify missing market evidence",
      reason: "Hermes PM identified an evidence gap",
      sourceRunId: startedParent.run.id,
    });
    assert.equal(delegated.childTask.parentTaskId, runningTask.id);
    assert.equal(delegated.childTask.agentId, research.id);
    assert.equal(delegated.childTask.triggerType, "DELEGATION");
    assert.equal(delegated.delegation.fromAgentId, hermes.id);
    assert.equal(delegated.delegation.toAgentId, research.id);
    assert.equal(delegated.delegation.sourceRunId, startedParent.run.id);

    const startedChild = await startAgentTask(adminSession, delegated.childTask.id);
    await assert.rejects(
      finishAgentTask(adminSession, delegated.childTask.id, {
        runId: startedChild.run.id,
        outcome: "SUCCEEDED",
      }),
      (error: any) => error?.statusCode === 422
    );

    const childSummary =
      "Verified three channel interviews; demand signal is real but sample size remains small. Recommend one controlled validation round before changing the product baseline.";
    const completedChild = await finishAgentTask(
      adminSession,
      delegated.childTask.id,
      {
        runId: startedChild.run.id,
        outcome: "SUCCEEDED",
        resultSummary: childSummary,
      }
    );
    assert.equal(completedChild.task.status, AgentTaskStatus.SUCCEEDED);
    assert.equal(completedChild.run.outputSummary, childSummary);

    const delegationReloaded = await prisma.agentDelegation.findUniqueOrThrow({
      where: { childTaskId: delegated.childTask.id },
    });
    assert.equal(delegationReloaded.status, "COMPLETED");

    const returnEvent = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: org.id,
          eventKey: `agent-task:${delegated.childTask.id}:terminal`,
        },
      },
      include: {
        autopilotReceipt: {
          include: {
            decisionRun: true,
            agentTask: { include: { agent: true } },
          },
        },
      },
    });
    assert.equal(returnEvent.status, "DISPATCHED");
    assert.equal(
      returnEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "workforce.resume_parent"
    );
    assert.equal(
      returnEvent.autopilotReceipt?.decisionRun?.resultJson &&
        typeof returnEvent.autopilotReceipt.decisionRun.resultJson === "object" &&
        !Array.isArray(returnEvent.autopilotReceipt.decisionRun.resultJson)
        ? (returnEvent.autopilotReceipt.decisionRun.resultJson as any).value
        : null,
      "hermes_pm"
    );
    assert.equal(returnEvent.autopilotReceipt?.agentTask?.agent.code, "hermes_pm");
    assert.match(
      returnEvent.autopilotReceipt?.agentTask?.goal ?? "",
      /Review returned child-agent result/
    );
    const returnContext =
      returnEvent.autopilotReceipt?.agentTask?.contextSnapshot &&
      typeof returnEvent.autopilotReceipt.agentTask.contextSnapshot === "object" &&
      !Array.isArray(returnEvent.autopilotReceipt.agentTask.contextSnapshot)
        ? (returnEvent.autopilotReceipt.agentTask.contextSnapshot as any)
        : null;
    assert.equal(returnContext?.state?.resultSummary, childSummary);
    assert.equal(returnContext?.state?.parentTaskId, runningTask.id);
    assert.equal(returnContext?.state?.childTaskId, delegated.childTask.id);
    assert.notEqual(
      returnEvent.autopilotReceipt?.agentTaskId,
      runningTask.id,
      "child return creates an independent review task instead of rewriting the parent task"
    );

    const parentUnchanged = await prisma.agentTask.findUniqueOrThrow({
      where: { id: runningTask.id },
    });
    assert.equal(
      parentUnchanged.status,
      AgentTaskStatus.RUNNING,
      "child completion must not silently mutate the original parent state"
    );

    const reviewTaskId = returnEvent.autopilotReceipt?.agentTaskId;
    assert.ok(reviewTaskId);
    const overviewWithReview = await getWorkforceOverview(adminSession);
    const visibleReview = overviewWithReview.returnReviews.find(
      (review) => review.id === reviewTaskId
    );
    assert.ok(visibleReview);
    assert.equal(visibleReview.returned.resultSummary, childSummary);

    const closed = await resolveReturnedChildReview(
      adminSession,
      reviewTaskId!,
      {
        action: "CLOSE_PARENT",
        reason:
          "Research result is sufficient for this work item; close the parent analysis without changing the governed product baseline.",
      }
    );
    assert.equal(closed.reviewTask.status, AgentTaskStatus.SUCCEEDED);
    assert.equal(closed.parentTask?.status, AgentTaskStatus.SUCCEEDED);

    const closedParentRun = await prisma.agentRun.findUniqueOrThrow({
      where: { id: startedParent.run.id },
    });
    assert.equal(closedParentRun.status, "SUCCEEDED");
    console.log("  ✔ child result is readable, reviewable, and can close the parent without touching business governance");

    console.log("▶ W5 waiting-human is explicit, not fake-success");
    const startedQueued = await startAgentTask(adminSession, queuedTask.id);
    const waiting = await finishAgentTask(adminSession, queuedTask.id, {
      runId: startedQueued.run.id,
      outcome: "WAITING_HUMAN",
      reason: "Need approval before changing the product baseline",
    });
    assert.equal(waiting.task.status, AgentTaskStatus.WAITING_HUMAN);
    assert.equal(waiting.run.status, "WAITING_CONFIRMATION");
    assert.equal(
      waiting.task.blockedReason,
      "Need approval before changing the product baseline"
    );

    const overview = await getWorkforceOverview(adminSession);
    const hermesOverview = overview.agents.find((agent) => agent.code === "hermes_pm");
    assert.ok(hermesOverview);
    assert.equal(hermesOverview.presence.waitingHuman, 1);
    assert.equal(hermesOverview.presence.workload, "IDLE");

    const activityBrief = await getWorkforceActivityBrief(adminSession);
    assert.ok(activityBrief.eventCount >= 1);
    assert.ok(activityBrief.triggeredCount >= 1);
    assert.equal(activityBrief.waitingHumanCount, 1);
    assert.equal(activityBrief.returnReviewCount, 0);
    assert.ok(
      activityBrief.attentionItems.some(
        (item) =>
          item.kind === "WAITING_HUMAN" && item.id === queuedTask.id
      )
    );
    console.log("  ✔ human decision gate and 24h Hermes activity brief expose real attention");

    console.log("▶ W6 tenant isolation blocks cross-org agent ids");
    await bootstrapDefaultWorkforce(outsiderSession);
    const otherAgent = await prisma.agent.findUniqueOrThrow({
      where: {
        organizationId_code: {
          organizationId: otherOrg.id,
          code: "hermes_pm",
        },
      },
    });
    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: otherAgent.id,
        goal: "cross-org invocation must not work",
      }),
      (error: any) => error?.statusCode === 404
    );
    console.log("  ✔ cross-organization agent access returns not found");

    const audits = await prisma.auditEvent.count({
      where: {
        actorId: admin.id,
        action: {
          in: [
            "WORKFORCE_BOOTSTRAPPED",
            "AGENT_TASK_CREATED",
            "AGENT_TASK_STARTED",
            "AGENT_TASK_DELEGATED",
            "AGENT_TASK_FINISHED",
            "AGENT_PARENT_TASK_CLOSED_FROM_RETURN",
          ],
        },
      },
    });
    assert.ok(audits >= 7);
    console.log("  ✔ workforce writes leave durable audit events");

    console.log("\n✅ Autonomous workforce kernel regression passed");
  } finally {
    for (const organizationId of [org.id, otherOrg.id]) {
      const userIds = (
        await prisma.user.findMany({
          where: { organizationId },
          select: { id: true },
        })
      ).map((row) => row.id);

      await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.actionProposal.deleteMany({ where: { organizationId } });
      await prisma.agentDelegation.deleteMany({ where: { organizationId } });
      await prisma.agentRun.deleteMany({ where: { organizationId } });
      await prisma.agentTask.deleteMany({ where: { organizationId } });
      await prisma.squadMember.deleteMany({
        where: { squad: { organizationId } },
      });
      await prisma.squad.deleteMany({ where: { organizationId } });
      await prisma.agentSkill.deleteMany({
        where: { agent: { organizationId } },
      });
      await prisma.skill.deleteMany({ where: { organizationId } });
      await prisma.agent.deleteMany({ where: { organizationId } });
      await prisma.organizationMember.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("❌ Autonomous workforce kernel regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
