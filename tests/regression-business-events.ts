import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  AutopilotEventStatus,
  BusinessEventStatus,
  EvidenceNature,
  EvidenceVerifyStatus,
  OrgRole,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createManualSignal } from "../src/modules/signal/manual-signal";
import {
  bootstrapDefaultAutopilots,
} from "../src/modules/autopilot";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import {
  BUSINESS_EVENT_TYPES,
  dispatchBusinessEvent,
  dispatchPendingBusinessEvents,
  enqueueBusinessEventInTx,
} from "../src/modules/business-events";
import {
  createDevelopmentProduct,
  publishProductVersion,
} from "../src/modules/products/service";
import { POST as verifyEvidencePost } from "../src/app/api/evidences/[id]/verify/route";

async function makeOrg(label: string) {
  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: label, code: "BE_" + tag },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "be-" + tag + "@hermes.test",
      name: label + " Admin",
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: OrgRole.ORG_ADMIN,
    },
  });
  return {
    org,
    user,
    session: {
      userId: user.id,
      organizationId: org.id,
      userEmail: user.email,
      userName: user.name,
    },
  };
}

async function eventWithReceipt(organizationId: string, eventKey: string) {
  return prisma.businessEvent.findUniqueOrThrow({
    where: {
      organizationId_eventKey: { organizationId, eventKey },
    },
    include: {
      autopilotReceipt: {
        include: {
          decisionRun: true,
          agentTask: { include: { agent: true } },
          autopilot: true,
        },
      },
    },
  });
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);
  process.env.DEV_MOCK_AUTH = "true";

  const a = await makeOrg("Business Event A");
  const b = await makeOrg("Business Event B");

  try {
    await bootstrapDefaultWorkforce(a.session);
    await bootstrapDefaultAutopilots(a.session);

    console.log("▶ B1 high-value manual Signal commits with durable outbox and wakes Hermes PM");
    const signal = await createManualSignal(a.session, {
      title: "私域用户开始集中询问新型抗衰原料",
      summary: "来自一线销售反馈，需进一步验证规模与持续性",
      valueTier: "high",
      valueReason: "直接影响新品机会判断，且已有明确渠道反馈线索",
      channel: "私域",
      productRef: "抗衰新品",
    });
    assert.equal(signal.verifyStatus, EvidenceVerifyStatus.UNVERIFIED);

    const signalEvent = await eventWithReceipt(
      a.org.id,
      `signal:${signal.id}:captured`
    );
    assert.equal(signalEvent.status, BusinessEventStatus.DISPATCHED);
    assert.ok(signalEvent.autopilotReceiptId);
    assert.equal(
      signalEvent.autopilotReceipt?.status,
      AutopilotEventStatus.TRIGGERED
    );
    assert.equal(signalEvent.autopilotReceipt?.autopilot.key, "signal_wake_pm");
    assert.equal(
      signalEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "signal.should_wake_pm"
    );
    assert.equal(signalEvent.autopilotReceipt?.decisionRun?.specVersion, "v2");
    assert.equal(
      signalEvent.autopilotReceipt?.agentTask?.agent.code,
      "hermes_pm"
    );
    const signalDecisionInput =
      signalEvent.autopilotReceipt?.decisionRun?.inputSnapshot as
        | Record<string, unknown>
        | null;
    assert.equal(signalDecisionInput?.valueTier, "high");
    assert.equal(signalDecisionInput?.hasValueReason, true);
    assert.equal("relevanceScore" in (signalDecisionInput ?? {}), false);
    console.log("  ✔ Signal V2 uses real fields only; no fabricated relevance score");

    console.log("▶ B2 high tier without value rationale is suppressed but fully traceable");
    const weakSignal = await createManualSignal(a.session, {
      title: "某平台出现一次性热词波动",
      valueTier: "high",
    });
    const weakEvent = await eventWithReceipt(
      a.org.id,
      `signal:${weakSignal.id}:captured`
    );
    assert.equal(weakEvent.status, BusinessEventStatus.DISPATCHED);
    assert.equal(
      weakEvent.autopilotReceipt?.status,
      AutopilotEventStatus.SUPPRESSED
    );
    assert.equal(weakEvent.autopilotReceipt?.agentTaskId, null);
    assert.ok(weakEvent.autopilotReceipt?.decisionRunId);
    console.log("  ✔ lack of rationale does not silently wake an Agent");

    console.log("▶ B3 duplicate Signal remains one domain fact, one event, one wakeup");
    const duplicate = await createManualSignal(a.session, {
      title: signal.title,
      summary: signal.summary ?? undefined,
      valueTier: "high",
      valueReason: signal.valueReason ?? undefined,
      channel: signal.channel ?? undefined,
      productRef: signal.productRef ?? undefined,
    });
    assert.equal(duplicate.id, signal.id);
    assert.equal(
      await prisma.businessEvent.count({
        where: {
          organizationId: a.org.id,
          aggregateType: "SignalItem",
          aggregateId: signal.id,
        },
      }),
      1
    );
    assert.equal(
      await prisma.agentTask.count({
        where: {
          organizationId: a.org.id,
          triggerDecisionRunId:
            signalEvent.autopilotReceipt?.decisionRunId ?? "__missing__",
        },
      }),
      1
    );
    console.log("  ✔ domain idempotency and automation idempotency align");

    console.log("▶ B4 published ProductVersion wakes Red Team");
    const development = await createDevelopmentProduct(a.session, {
      name: "渠道适配新品",
      coreIdea: "验证不同渠道规格与价格机制",
      targetAudience: "35岁以上私域用户",
      coreSellingPoints: "可验证的产品体验与规格差异",
      targetChannels: "私域",
      priceExpectation: "299",
      formSpec: "30条/盒",
    });
    const version = await publishProductVersion(
      a.session,
      development.product.id,
      {
        versionTag: "v2",
        specs: {
          formSpec: "30条/盒",
          channel: "私域",
          price: 299,
        },
        unknowns: {
          repeatPurchase: "待验证",
        },
      }
    );
    const versionEvent = await eventWithReceipt(
      a.org.id,
      `product-version:${version.id}:published`
    );
    assert.equal(versionEvent.status, BusinessEventStatus.DISPATCHED);
    assert.equal(
      versionEvent.autopilotReceipt?.autopilot.key,
      "product_version_red_team"
    );
    assert.equal(
      versionEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "product_version.should_red_team"
    );
    assert.equal(
      versionEvent.autopilotReceipt?.agentTask?.agent.code,
      "red_team"
    );
    console.log("  ✔ immutable ProductVersion change now produces an automatic challenge task");

    console.log("▶ B5 formally verified REAL evidence wakes Hermes PM for re-evaluation");
    const evidence = await prisma.evidence.create({
      data: {
        projectId: development.project.id,
        contentOrUri: "https://example.com/verified-channel-feedback",
        source: "渠道负责人书面反馈",
        hash: randomUUID().replaceAll("-", ""),
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
        validationStatus: "UNAPPLIED",
      },
    });

    const req = new NextRequest(
      "http://localhost/api/evidences/" + evidence.id + "/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": a.user.id,
          "x-organization-id": a.org.id,
        },
        body: JSON.stringify({ status: "VERIFIED" }),
      }
    );
    const response = await verifyEvidencePost(req, {
      params: Promise.resolve({ id: evidence.id }),
    });
    assert.equal(response.status, 200);

    const evidenceEvent = await eventWithReceipt(
      a.org.id,
      `evidence:${evidence.id}:verified`
    );
    assert.equal(evidenceEvent.status, BusinessEventStatus.DISPATCHED);
    assert.equal(
      evidenceEvent.autopilotReceipt?.autopilot.key,
      "evidence_recheck_pm"
    );
    assert.equal(
      evidenceEvent.autopilotReceipt?.decisionRun?.decisionKey,
      "evidence.should_wake_pm"
    );
    assert.equal(
      evidenceEvent.autopilotReceipt?.agentTask?.agent.code,
      "hermes_pm"
    );
    console.log("  ✔ verified evidence now closes the loop back into product judgment");

    console.log("▶ B6 business write survives missing Autopilot and drains after bootstrap");
    const offlineSignal = await createManualSignal(b.session, {
      title: "尚未启用数字员工时录入的重要市场机会",
      valueTier: "high",
      valueReason: "需要在启用系统后补处理",
    });
    const pendingBefore = await prisma.businessEvent.findUniqueOrThrow({
      where: {
        organizationId_eventKey: {
          organizationId: b.org.id,
          eventKey: `signal:${offlineSignal.id}:captured`,
        },
      },
    });
    assert.equal(pendingBefore.status, BusinessEventStatus.PENDING);
    assert.match(pendingBefore.lastError ?? "", /AUTOPILOT_NOT_CONFIGURED/);
    assert.equal(
      await prisma.signalItem.count({
        where: { id: offlineSignal.id, organizationId: b.org.id },
      }),
      1
    );

    await bootstrapDefaultWorkforce(b.session);
    await bootstrapDefaultAutopilots(b.session);
    const drained = await dispatchPendingBusinessEvents(b.org.id, {
      workerId: "recovery-drain",
    });
    assert.ok(
      drained.some(
        (row) =>
          row.eventId === pendingBefore.id &&
          row.disposition === "DISPATCHED"
      )
    );
    const afterDrain = await eventWithReceipt(
      b.org.id,
      `signal:${offlineSignal.id}:captured`
    );
    assert.equal(afterDrain.status, BusinessEventStatus.DISPATCHED);
    assert.equal(
      afterDrain.autopilotReceipt?.agentTask?.agent.code,
      "hermes_pm"
    );
    console.log("  ✔ transactional outbox removes the business-write/automation dual-write gap");

    console.log("▶ B7 outbox idempotency rejects same key with different payload");
    const idempotentA = await prisma.$transaction((tx) =>
      enqueueBusinessEventInTx(tx, {
        organizationId: a.org.id,
        eventKey: "test:idempotent",
        eventType: BUSINESS_EVENT_TYPES.SIGNAL_CAPTURED,
        aggregateType: "SignalItem",
        aggregateId: signal.id,
        payload: {
          title: signal.title,
          valueTier: "high",
          valueReason: "same",
          nature: "REAL",
          verifyStatus: "UNVERIFIED",
        },
        contextRefs: [`signal:${signal.id}`],
        createdById: a.user.id,
      })
    );
    const idempotentB = await prisma.$transaction((tx) =>
      enqueueBusinessEventInTx(tx, {
        organizationId: a.org.id,
        eventKey: "test:idempotent",
        eventType: BUSINESS_EVENT_TYPES.SIGNAL_CAPTURED,
        aggregateType: "SignalItem",
        aggregateId: signal.id,
        payload: {
          title: signal.title,
          valueTier: "high",
          valueReason: "same",
          nature: "REAL",
          verifyStatus: "UNVERIFIED",
        },
        contextRefs: [`signal:${signal.id}`],
        createdById: a.user.id,
      })
    );
    assert.equal(idempotentA.id, idempotentB.id);
    await assert.rejects(
      prisma.$transaction((tx) =>
        enqueueBusinessEventInTx(tx, {
          organizationId: a.org.id,
          eventKey: "test:idempotent",
          eventType: BUSINESS_EVENT_TYPES.SIGNAL_CAPTURED,
          aggregateType: "SignalItem",
          aggregateId: signal.id,
          payload: {
            title: "different payload",
            valueTier: "low",
          },
          contextRefs: [`signal:${signal.id}`],
          createdById: a.user.id,
        })
      ),
      (error: any) => error?.statusCode === 409
    );
    console.log("  ✔ eventKey is a factual idempotency key, not an overwrite handle");

    console.log("▶ B8 expired outbox lease is reclaimable; a live lease is not");
    const stale = await prisma.$transaction((tx) =>
      enqueueBusinessEventInTx(tx, {
        organizationId: a.org.id,
        eventKey: "test:stale-lease",
        eventType: BUSINESS_EVENT_TYPES.SIGNAL_CAPTURED,
        aggregateType: "SignalItem",
        aggregateId: "stale-source",
        payload: {
          title: "stale lease signal",
          valueTier: "high",
          valueReason: "lease recovery",
          nature: "REAL",
          verifyStatus: "UNVERIFIED",
        },
        contextRefs: ["signal:stale-source"],
      })
    );
    await prisma.businessEvent.update({
      where: { id: stale.id },
      data: {
        status: BusinessEventStatus.PROCESSING,
        attempt: 1,
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const reclaimed = await dispatchBusinessEvent(a.org.id, stale.id, {
      workerId: "recovery-worker",
    });
    assert.equal(reclaimed.disposition, "DISPATCHED");
    const staleAfter = await prisma.businessEvent.findUniqueOrThrow({
      where: { id: stale.id },
    });
    assert.equal(staleAfter.attempt, 2);
    assert.equal(staleAfter.leaseOwner, null);

    const live = await prisma.$transaction((tx) =>
      enqueueBusinessEventInTx(tx, {
        organizationId: a.org.id,
        eventKey: "test:live-lease",
        eventType: BUSINESS_EVENT_TYPES.SIGNAL_CAPTURED,
        aggregateType: "SignalItem",
        aggregateId: "live-source",
        payload: {
          title: "live lease signal",
          valueTier: "high",
          valueReason: "must not steal live lease",
          nature: "REAL",
          verifyStatus: "UNVERIFIED",
        },
        contextRefs: ["signal:live-source"],
      })
    );
    await prisma.businessEvent.update({
      where: { id: live.id },
      data: {
        status: BusinessEventStatus.PROCESSING,
        attempt: 1,
        leaseOwner: "live-worker",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await assert.rejects(
      dispatchBusinessEvent(a.org.id, live.id, {
        workerId: "stealing-worker",
      }),
      (error: any) => error?.statusCode === 409
    );
    console.log("  ✔ outbox worker crash recovery does not permit double-processing a live lease");

    console.log("\n✅ Business event outbox regression passed");
  } finally {
    for (const orgId of [a.org.id, b.org.id]) {
      const userIds = (
        await prisma.user.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        })
      ).map((row) => row.id);
      await prisma.auditEvent.deleteMany({
        where: { actorId: { in: userIds } },
      });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma.$disconnect();
    delete process.env.DEV_MOCK_AUTH;
  }
}

main().catch(async (error) => {
  console.error("❌ Business event outbox regression failed:", error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exitCode = 1;
});
