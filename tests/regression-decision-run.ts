import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AgentTriggerType,
  OrgRole,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  DecisionIntelligenceKernel,
  createDefaultDecisionSpecs,
  createDefaultRulesDecisionEngine,
  decideAndPersist,
} from "../src/modules/decision-intelligence";
import {
  bootstrapDefaultWorkforce,
  createAgentTask,
} from "../src/modules/workforce/service";

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Decision Provenance Test", code: "DEC_" + tag },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: "Decision Other Test", code: "DEC_OTHER_" + tag },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "decision-admin-" + tag + "@hermes.test",
      name: "Decision Admin",
    },
  });
  const outsider = await prisma.user.create({
    data: {
      organizationId: otherOrg.id,
      email: "decision-outsider-" + tag + "@hermes.test",
      name: "Decision Outsider",
    },
  });

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN },
      {
        organizationId: otherOrg.id,
        userId: outsider.id,
        role: OrgRole.ORG_ADMIN,
      },
    ],
  });

  const adminSession = {
    userId: admin.id,
    organizationId: org.id,
    userEmail: admin.email,
    userName: admin.name,
  };
  const outsiderSession = {
    userId: outsider.id,
    organizationId: otherOrg.id,
    userEmail: outsider.email,
    userName: outsider.name,
  };

  const specs = createDefaultDecisionSpecs();
  const rules = createDefaultRulesDecisionEngine();
  const kernel = new DecisionIntelligenceKernel(specs);
  kernel.registerEngine(rules);

  try {
    const workforce = await bootstrapDefaultWorkforce(adminSession);
    await bootstrapDefaultWorkforce(outsiderSession);

    const agents = await prisma.agent.findMany({
      where: { organizationId: org.id },
    });
    const byCode = new Map(agents.map((agent) => [agent.code, agent]));
    const research = byCode.get("research_agent");
    const product = byCode.get("product_agent");
    const hermes = byCode.get("hermes_pm");
    assert.ok(research && product && hermes);

    console.log("▶ D1 DecisionRun freezes typed decision provenance");
    const first = await decideAndPersist(adminSession, kernel, {
      decisionKey: "workforce.route_agent",
      state: {
        needsResearch: true,
        taskClass: "RESEARCH",
        nested: { z: 2, a: 1 },
      },
      criteria: { urgency: "normal" },
      contextRefs: ["work-item:2", "signal:1", "signal:1"],
      language: "zh-CN",
    });

    assert.equal(first.execution.engineResult.value, "research_agent");
    assert.equal(first.execution.policy.action, "AUTO");
    assert.equal(first.decisionRun.decisionKey, "workforce.route_agent");
    assert.equal(first.decisionRun.specVersion, "v1");
    assert.equal(first.decisionRun.engine, "RULES");
    assert.equal(first.decisionRun.policyAction, "AUTO");
    assert.match(first.decisionRun.inputHash, /^[a-f0-9]{64}$/);
    assert.match(first.decisionRun.criteriaHash ?? "", /^[a-f0-9]{64}$/);
    assert.deepEqual(first.decisionRun.contextRefs, [
      "signal:1",
      "work-item:2",
    ]);

    const replay = await decideAndPersist(adminSession, kernel, {
      decisionKey: "workforce.route_agent",
      state: {
        nested: { a: 1, z: 2 },
        taskClass: "RESEARCH",
        needsResearch: true,
      },
      criteria: { urgency: "normal" },
      contextRefs: ["signal:1", "work-item:2"],
      language: "zh-CN",
    });
    assert.equal(replay.decisionRun.inputHash, first.decisionRun.inputHash);
    console.log("  ✔ canonical input hash is stable across key/ref ordering");

    console.log("▶ D2 route_agent AUTO may create only the selected AgentTask");
    const routedTask = await createAgentTask(adminSession, {
      agentId: research.id,
      squadId: workforce.squad.id,
      goal: "补齐新品渠道与证据研究",
      triggerType: AgentTriggerType.AUTOPILOT,
      triggerDecisionRunId: first.decisionRun.id,
      triggerRef: "signal:1",
    });
    assert.equal(routedTask.triggerDecisionRunId, first.decisionRun.id);
    assert.equal(routedTask.agentId, research.id);

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: product.id,
        squadId: workforce.squad.id,
        goal: "wrong target must fail",
        triggerType: AgentTriggerType.AUTOPILOT,
        triggerDecisionRunId: first.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 422
    );

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: research.id,
        squadId: workforce.squad.id,
        goal: "AUTO provenance cannot masquerade as manual",
        triggerType: AgentTriggerType.MANUAL,
        triggerDecisionRunId: first.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 422
    );
    console.log("  ✔ route choice, target Agent, and autonomous trigger type are bound");

    console.log("▶ D3 signal wake decisions can wake Hermes PM only when value=true");
    const wake = await decideAndPersist(adminSession, kernel, {
      decisionKey: "signal.should_wake_pm",
      state: {
        actionable: true,
        duplicate: false,
        blocked: false,
        relevanceScore: 91,
      },
      contextRefs: ["signal:381"],
    });
    assert.equal(wake.execution.engineResult.value, true);

    const pmTask = await createAgentTask(adminSession, {
      agentId: hermes.id,
      squadId: workforce.squad.id,
      goal: "Review material signal 381",
      triggerType: AgentTriggerType.EVENT,
      triggerDecisionRunId: wake.decisionRun.id,
      triggerRef: "signal:381",
    });
    assert.equal(pmTask.agentId, hermes.id);

    const noWake = await decideAndPersist(adminSession, kernel, {
      decisionKey: "signal.should_wake_pm",
      state: {
        actionable: true,
        duplicate: true,
        blocked: false,
        relevanceScore: 99,
      },
      contextRefs: ["signal:382"],
    });
    assert.equal(noWake.execution.engineResult.value, false);

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: hermes.id,
        squadId: workforce.squad.id,
        goal: "duplicate signal must not wake PM",
        triggerType: AgentTriggerType.EVENT,
        triggerDecisionRunId: noWake.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 422
    );

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: research.id,
        squadId: workforce.squad.id,
        goal: "wake decision cannot route to specialist",
        triggerType: AgentTriggerType.EVENT,
        triggerDecisionRunId: wake.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 422
    );
    console.log("  ✔ false/duplicate signals cannot create wakeup tasks");

    console.log("▶ D4 non-triggering specs cannot be reinterpreted as task authorization");
    const needsHuman = await decideAndPersist(adminSession, kernel, {
      decisionKey: "workforce.needs_human",
      state: { businessMutation: true },
      contextRefs: ["proposal:1"],
    });
    assert.equal(needsHuman.execution.engineResult.value, true);
    assert.equal(needsHuman.execution.policy.action, "AUTO");

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: hermes.id,
        squadId: workforce.squad.id,
        goal: "needs-human result must not become an AgentTask permission",
        triggerType: AgentTriggerType.SYSTEM,
        triggerDecisionRunId: needsHuman.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 422
    );

    const priority = await decideAndPersist(adminSession, kernel, {
      decisionKey: "workforce.task_priority",
      state: { blocking: true, customerImpact: true },
      contextRefs: ["task:candidate"],
    });
    assert.equal(typeof priority.execution.engineResult.value, "number");

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: hermes.id,
        squadId: workforce.squad.id,
        goal: "priority score is not trigger authority",
        triggerType: AgentTriggerType.SYSTEM,
        triggerDecisionRunId: priority.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 422
    );
    console.log("  ✔ AUTO eligibility is spec-specific, not a generic permission bit");

    console.log("▶ D5 DecisionRun tenant boundary fails closed");
    const otherDecision = await decideAndPersist(outsiderSession, kernel, {
      decisionKey: "signal.should_wake_pm",
      state: {
        actionable: true,
        duplicate: false,
        blocked: false,
        relevanceScore: 90,
      },
      contextRefs: ["foreign-signal:1"],
    });

    await assert.rejects(
      createAgentTask(adminSession, {
        agentId: hermes.id,
        squadId: workforce.squad.id,
        goal: "cross-org provenance must not be visible",
        triggerType: AgentTriggerType.EVENT,
        triggerDecisionRunId: otherDecision.decisionRun.id,
      }),
      (error: any) => error?.statusCode === 404
    );
    console.log("  ✔ cross-organization DecisionRun returns not found");

    console.log("▶ D6 provenance is queryable from the task and auditable");
    const reloaded = await prisma.agentTask.findUniqueOrThrow({
      where: { id: routedTask.id },
      include: { triggerDecisionRun: true },
    });
    assert.equal(
      reloaded.triggerDecisionRun?.decisionKey,
      "workforce.route_agent"
    );
    assert.equal(reloaded.triggerDecisionRun?.inputHash, first.decisionRun.inputHash);

    const decisionAudits = await prisma.auditEvent.count({
      where: {
        actorId: admin.id,
        action: "DECISION_RUN_RECORDED",
      },
    });
    assert.ok(decisionAudits >= 5);

    const taskAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        actorId: admin.id,
        action: "AGENT_TASK_CREATED",
        objectId: routedTask.id,
      },
    });
    const details = taskAudit.details as Record<string, unknown> | null;
    assert.equal(details?.triggerDecisionRunId, first.decisionRun.id);
    console.log("  ✔ task → DecisionRun → exact spec/input/policy chain is durable");

    console.log("\n✅ DecisionRun provenance regression passed");
  } finally {
    for (const organizationId of [org.id, otherOrg.id]) {
      const userIds = (
        await prisma.user.findMany({
          where: { organizationId },
          select: { id: true },
        })
      ).map((row) => row.id);

      await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("❌ DecisionRun provenance regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
