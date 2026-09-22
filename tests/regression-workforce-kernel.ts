import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentAccessMode, AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  bootstrapDefaultWorkforce,
  createAgentTask,
  delegateAgentTask,
  finishAgentTask,
  getWorkforceOverview,
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

    assert.equal(await prisma.agent.count({ where: { organizationId: org.id } }), 6);
    assert.equal(await prisma.skill.count({ where: { organizationId: org.id } }), 6);
    assert.equal(await prisma.squad.count({ where: { organizationId: org.id } }), 1);
    assert.equal(
      await prisma.squadMember.count({ where: { squadId: first.squad.id } }),
      6
    );
    console.log("  ✔ one stable Hermes squad, six agents, six skills");

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
    const completedChild = await finishAgentTask(
      adminSession,
      delegated.childTask.id,
      {
        runId: startedChild.run.id,
        outcome: "SUCCEEDED",
      }
    );
    assert.equal(completedChild.task.status, AgentTaskStatus.SUCCEEDED);

    const delegationReloaded = await prisma.agentDelegation.findUniqueOrThrow({
      where: { childTaskId: delegated.childTask.id },
    });
    assert.equal(delegationReloaded.status, "COMPLETED");
    console.log("  ✔ Hermes PM → Research Agent handoff is traceable and completes");

    console.log("▶ W5 waiting-human is explicit, not fake-success");
    const waiting = await finishAgentTask(adminSession, runningTask.id, {
      runId: startedParent.run.id,
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
    assert.equal(hermesOverview.presence.workload, "QUEUED");
    console.log("  ✔ human decision gate is visible in workforce presence");

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
