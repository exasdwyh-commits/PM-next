import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AutopilotEventStatus,
  AutopilotStatus,
  OrgRole,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  bootstrapDefaultAutopilots,
  processAutopilotReceipt,
  setAutopilotPaused,
  submitAutopilotEvent,
} from "../src/modules/autopilot";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { createSession } from "../src/modules/identity/session";
import { getOrCreateSystemPrincipalSession } from "../src/modules/identity/system-principal";

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Autopilot Test", code: "AUTO_" + tag },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: "Autopilot Other", code: "AUTO_OTHER_" + tag },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "auto-admin-" + tag + "@hermes.test",
      name: "Autopilot Admin",
    },
  });
  const otherAdmin = await prisma.user.create({
    data: {
      organizationId: otherOrg.id,
      email: "auto-other-" + tag + "@hermes.test",
      name: "Autopilot Other Admin",
    },
  });

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN },
      {
        organizationId: otherOrg.id,
        userId: otherAdmin.id,
        role: OrgRole.ORG_ADMIN,
      },
    ],
  });

  const session = {
    userId: admin.id,
    organizationId: org.id,
    userEmail: admin.email,
    userName: admin.name,
  };
  const otherSession = {
    userId: otherAdmin.id,
    organizationId: otherOrg.id,
    userEmail: otherAdmin.email,
    userName: otherAdmin.name,
  };

  try {
    const workforce = await bootstrapDefaultWorkforce(session);
    await bootstrapDefaultWorkforce(otherSession);
    const autopilot = await bootstrapDefaultAutopilots(session);
    await bootstrapDefaultAutopilots(otherSession);

    console.log("▶ A1 system principal is explicit and cannot receive interactive sessions");
    const systemSession = await getOrCreateSystemPrincipalSession(org.id);
    const systemUser = await prisma.user.findUniqueOrThrow({
      where: { id: systemSession.userId },
    });
    assert.equal(systemUser.isSystem, true);
    assert.equal(systemUser.passwordHash, null);
    await assert.rejects(
      createSession(systemUser.id),
      (error: any) => error?.statusCode === 403
    );
    console.log("  ✔ autonomous audit principal cannot become an interactive login");

    console.log("▶ A2 event submission is idempotent and payload mismatch fails closed");
    const first = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:381",
      eventType: "SIGNAL_INGESTED",
      sourceType: "SignalItem",
      sourceId: "381",
      state: {
        actionable: true,
        duplicate: false,
        blocked: false,
        relevanceScore: 91,
      },
      contextRefs: ["signal:381", "source:reuters", "signal:381"],
      taskGoal: "Review signal 381 and decide whether it changes product priorities",
    });
    assert.equal(first.deduplicated, false);
    assert.equal(first.receipt.status, AutopilotEventStatus.PENDING);

    const duplicate = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:381",
      eventType: "SIGNAL_INGESTED",
      sourceType: "SignalItem",
      sourceId: "381",
      state: {
        blocked: false,
        duplicate: false,
        relevanceScore: 91,
        actionable: true,
      },
      contextRefs: ["source:reuters", "signal:381"],
      taskGoal: "Review signal 381 and decide whether it changes product priorities",
    });
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.receipt.id, first.receipt.id);

    await assert.rejects(
      submitAutopilotEvent({
        organizationId: org.id,
        autopilotKey: "signal_wake_pm",
        eventKey: "signal:381",
        eventType: "SIGNAL_INGESTED",
        sourceType: "SignalItem",
        sourceId: "381",
        state: {
          actionable: false,
          duplicate: false,
          blocked: false,
          relevanceScore: 20,
        },
        contextRefs: ["signal:381"],
        taskGoal: "Different payload under same key",
      }),
      (error: any) => error?.statusCode === 409
    );
    console.log("  ✔ duplicate event returns the same durable receipt; key reuse cannot overwrite facts");

    console.log("▶ A3 actionable signal wakes Hermes PM exactly once");
    const processed = await processAutopilotReceipt(
      org.id,
      first.receipt.id,
      { workerId: "worker-a" }
    );
    assert.equal(processed.disposition, "TRIGGERED");
    assert.equal(processed.receipt.status, AutopilotEventStatus.TRIGGERED);
    assert.ok(processed.receipt.decisionRunId);
    assert.ok(processed.receipt.agentTaskId);

    const task = await prisma.agentTask.findUniqueOrThrow({
      where: { id: processed.receipt.agentTaskId! },
      include: {
        agent: true,
        triggerDecisionRun: true,
        autopilotReceipt: true,
      },
    });
    assert.equal(task.agent.code, "hermes_pm");
    assert.equal(task.triggerType, "EVENT");
    assert.equal(
      task.triggerDecisionRun?.decisionKey,
      "signal.should_wake_pm"
    );
    assert.equal(task.autopilotReceipt?.id, first.receipt.id);
    assert.equal(task.createdByUserId, systemUser.id);

    const processedAgain = await processAutopilotReceipt(
      org.id,
      first.receipt.id,
      { workerId: "worker-b" }
    );
    assert.equal(processedAgain.disposition, "TRIGGERED");
    assert.equal(
      await prisma.agentTask.count({
        where: { organizationId: org.id, id: task.id },
      }),
      1
    );
    console.log("  ✔ terminal receipt is replay-safe; no second AgentTask is created");

    console.log("▶ A4 duplicate/low-value signal is durably suppressed, not silently dropped");
    const low = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:382",
      eventType: "SIGNAL_INGESTED",
      sourceType: "SignalItem",
      sourceId: "382",
      state: {
        actionable: true,
        duplicate: true,
        blocked: false,
        relevanceScore: 99,
      },
      contextRefs: ["signal:382"],
      taskGoal: "Should not wake PM",
    });
    const lowResult = await processAutopilotReceipt(
      org.id,
      low.receipt.id,
      { workerId: "worker-a" }
    );
    assert.equal(lowResult.disposition, "SUPPRESSED");
    assert.equal(lowResult.receipt.suppressionReason, "DECISION_FALSE");
    assert.equal(lowResult.receipt.agentTaskId, null);
    assert.ok(lowResult.receipt.decisionRunId);
    console.log("  ✔ negative decision still has DecisionRun + receipt provenance");

    console.log("▶ A5 manual pause defers pending receipts and resume releases them");
    await setAutopilotPaused(session, autopilot.id, true, "operator pause");
    const pausedEvent = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:383",
      eventType: "SIGNAL_INGESTED",
      sourceType: "SignalItem",
      sourceId: "383",
      state: {
        actionable: true,
        duplicate: false,
        blocked: false,
        relevanceScore: 88,
      },
      contextRefs: ["signal:383"],
      taskGoal: "Review signal 383 after resume",
    });
    const deferred = await processAutopilotReceipt(
      org.id,
      pausedEvent.receipt.id,
      { workerId: "worker-a" }
    );
    assert.equal(deferred.disposition, "DEFERRED");
    assert.equal(deferred.receipt.status, AutopilotEventStatus.PENDING);

    await setAutopilotPaused(session, autopilot.id, false, "resume");
    const afterResume = await processAutopilotReceipt(
      org.id,
      pausedEvent.receipt.id,
      { workerId: "worker-a" }
    );
    assert.equal(afterResume.disposition, "TRIGGERED");
    console.log("  ✔ pause does not discard work; pending receipt resumes deterministically");

    console.log("▶ A6 failure budget opens cooldown and blocks a failure storm");
    await prisma.autopilot.update({
      where: { id: autopilot.id },
      data: {
        decisionKey: "unknown.decision",
        failureThreshold: 1,
        cooldownSeconds: 60,
        status: AutopilotStatus.ACTIVE,
        pausedUntil: null,
        consecutiveFailures: 0,
      },
    });

    const bad = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:bad",
      eventType: "SIGNAL_INGESTED",
      state: { actionable: true },
      contextRefs: ["signal:bad"],
      taskGoal: "This should fail at DecisionSpec lookup",
      maxAttempts: 3,
    });
    await assert.rejects(
      processAutopilotReceipt(org.id, bad.receipt.id, {
        workerId: "worker-fail",
      }),
      /DecisionSpec not found/
    );

    const cooled = await prisma.autopilot.findUniqueOrThrow({
      where: { id: autopilot.id },
    });
    assert.equal(cooled.consecutiveFailures, 1);
    assert.ok(cooled.pausedUntil);
    assert.ok((cooled.pausedUntil?.getTime() ?? 0) > Date.now());

    const queuedDuringCooldown = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:cooldown",
      eventType: "SIGNAL_INGESTED",
      state: {
        actionable: true,
        duplicate: false,
        blocked: false,
        relevanceScore: 90,
      },
      contextRefs: ["signal:cooldown"],
      taskGoal: "Wait until Autopilot recovers",
    });
    const cooldownResult = await processAutopilotReceipt(
      org.id,
      queuedDuringCooldown.receipt.id,
      { workerId: "worker-fail" }
    );
    assert.equal(cooldownResult.disposition, "DEFERRED");
    assert.equal(
      cooldownResult.receipt.status,
      AutopilotEventStatus.PENDING
    );

    await prisma.autopilot.update({
      where: { id: autopilot.id },
      data: {
        decisionKey: "signal.should_wake_pm",
        decisionSpecVersion: "v1",
      },
    });
    await setAutopilotPaused(session, autopilot.id, false, "provider/config fixed");
    const recovered = await processAutopilotReceipt(
      org.id,
      queuedDuringCooldown.receipt.id,
      { workerId: "worker-recovered" }
    );
    assert.equal(recovered.disposition, "TRIGGERED");
    const healthy = await prisma.autopilot.findUniqueOrThrow({
      where: { id: autopilot.id },
    });
    assert.equal(healthy.consecutiveFailures, 0);
    assert.equal(healthy.pausedUntil, null);
    console.log("  ✔ failure storm becomes durable cooldown; manual recovery resets failure streak");

    console.log("▶ A7 expired processing lease is reclaimable after worker crash");
    const leaseEvent = await submitAutopilotEvent({
      organizationId: org.id,
      autopilotKey: "signal_wake_pm",
      eventKey: "signal:lease",
      eventType: "SIGNAL_INGESTED",
      state: {
        actionable: true,
        duplicate: false,
        blocked: false,
        relevanceScore: 87,
      },
      contextRefs: ["signal:lease"],
      taskGoal: "Recover stale worker lease",
    });
    await prisma.autopilotEventReceipt.update({
      where: { id: leaseEvent.receipt.id },
      data: {
        status: AutopilotEventStatus.PROCESSING,
        attempt: 1,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });

    const reclaimed = await processAutopilotReceipt(
      org.id,
      leaseEvent.receipt.id,
      { workerId: "recovery-worker" }
    );
    assert.equal(reclaimed.disposition, "TRIGGERED");
    assert.equal(reclaimed.receipt.attempt, 2);
    assert.equal(reclaimed.receipt.leaseOwner, null);
    console.log("  ✔ stale lease resumes without rerunning a still-live worker");

    console.log("▶ A8 tenant isolation hides receipts from other organizations");
    await assert.rejects(
      processAutopilotReceipt(otherOrg.id, leaseEvent.receipt.id, {
        workerId: "foreign-worker",
      }),
      (error: any) => error?.statusCode === 404
    );
    console.log("  ✔ cross-org receipt processing returns 404");

    const processedAudit = await prisma.auditEvent.count({
      where: {
        actorId: systemUser.id,
        action: "AUTOPILOT_EVENT_PROCESSED",
      },
    });
    assert.ok(processedAudit >= 4);

    console.log("\n✅ Autopilot event wakeup regression passed");
  } finally {
    for (const organizationId of [org.id, otherOrg.id]) {
      const userIds = (
        await prisma.user.findMany({
          where: { organizationId },
          select: { id: true },
        })
      ).map((row) => row.id);
      await prisma.auditEvent.deleteMany({
        where: { actorId: { in: userIds } },
      });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("❌ Autopilot event wakeup regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
