import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { Role } from "@prisma/client";
import { createRevision } from "../src/modules/product-development/revision";
import { analyzeProductVersion } from "../src/modules/product-development/analysis";
import { createWorkItemInTx } from "../src/modules/work/service";
import { createProposal, applyProposal, rejectProposal } from "../src/modules/advisor/proposals";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Governance CAS Test", code: `GOV_CAS_${tag}` },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `gov-${tag}@hermes.test`,
      name: "Governance Owner",
    },
  });
  const session = {
    userId: user.id,
    organizationId: org.id,
    userEmail: user.email,
    userName: user.name,
  };
  const viewer = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `viewer-${tag}@hermes.test`,
      name: "Governance Viewer",
    },
  });
  const viewerSession = {
    userId: viewer.id,
    organizationId: org.id,
    userEmail: viewer.email,
    userName: viewer.name,
  };

  try {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        name: "CAS Product",
        identityCode: `CAS-${tag}`,
        targetAudience: "test audience",
        marketPath: "test channel",
        devMode: "TEST",
        ownerId: user.id,
      },
    });
    const baseVersion = await prisma.productVersion.create({
      data: {
        productId: product.id,
        versionTag: "v1",
        specs: {
          coreIdea: "base idea",
          targetAudience: "test audience",
          coreSellingPoints: "base selling point",
        },
        isImmutable: true,
      },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        title: "CAS Project",
        target: "governance regression",
        ownerId: user.id,
        productId: product.id,
        productVersionId: baseVersion.id,
      },
    });
    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: user.id, role: Role.OWNER },
        { projectId: project.id, userId: viewer.id, role: Role.VIEWER },
      ],
    });

    console.log("▶ G1 methodRevision CAS: concurrent revisions must not both commit");
    const attempts = await Promise.allSettled([
      createRevision(
        session,
        {
          productId: product.id,
          baseVersionId: baseVersion.id,
          changes: { coreIdea: "revision A" },
          expectedMethodRevision: 0,
          note: "CAS A",
        },
        { deferAnalysis: true }
      ),
      createRevision(
        session,
        {
          productId: product.id,
          baseVersionId: baseVersion.id,
          changes: { coreSellingPoints: "revision B" },
          expectedMethodRevision: 0,
          note: "CAS B",
        },
        { deferAnalysis: true }
      ),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((r) => r.status === "rejected").length, 1);

    const afterCas = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    const versionsAfterCas = await prisma.productVersion.count({ where: { productId: product.id } });
    const revisionAudits = await prisma.auditEvent.count({
      where: { actorId: user.id, action: "PRODUCT_VERSION_REVISED", objectId: product.id },
    });
    assert.equal(afterCas.methodRevision, 1);
    assert.equal(versionsAfterCas, 2);
    assert.equal(revisionAudits, 1);
    console.log("  ✔ only one revision committed; methodRevision=1; one audit exists");

    console.log("▶ G2 audit fail-closed: work item must roll back when audit insert fails");
    const beforeItems = await prisma.workItem.count({ where: { projectId: project.id } });
    const fakeSession = { ...session, userId: randomUUID() };
    await assert.rejects(
      prisma.$transaction((tx) =>
        createWorkItemInTx(tx, fakeSession, project.id, {
          title: "must rollback",
          target: "audit failure",
          deliverableReq: "none",
        })
      )
    );
    const afterItems = await prisma.workItem.count({ where: { projectId: project.id } });
    assert.equal(afterItems, beforeItems);
    console.log("  ✔ audit FK failure rolled back the work item");

    console.log("▶ G3 proposal row-lock + idempotency: concurrent confirms create one object");
    const proposal = await createProposal(session, {
      actionType: "CREATE_WORK_ITEM",
      projectId: project.id,
      payload: {
        projectId: project.id,
        title: "Atomic proposal work",
        target: "one object only",
        deliverableReq: "atomic receipt",
      },
      idempotencyKey: `proposal-create-${tag}`,
    });

    const applyKey = `proposal-apply-${tag}`;
    const applied = await Promise.all([
      applyProposal(session, proposal.proposalId, { idempotencyKey: applyKey, reason: "parallel confirm" }),
      applyProposal(session, proposal.proposalId, { idempotencyKey: applyKey, reason: "parallel confirm" }),
    ]);

    assert.equal(applied[0].appliedObjectId, applied[1].appliedObjectId);
    const createdItems = await prisma.workItem.count({
      where: { projectId: project.id, title: "Atomic proposal work" },
    });
    assert.equal(createdItems, 1);

    const appliedProposal = await prisma.actionProposal.findUniqueOrThrow({
      where: { id: proposal.proposalId },
    });
    assert.equal(appliedProposal.status, "APPLIED");
    assert.ok(appliedProposal.appliedObjectId);

    const idem = await prisma.idempotencyRecord.findUnique({
      where: { key: `proposal.apply#${applyKey}` },
    });
    assert.equal(idem?.responseStatus, 200);

    const proposalAudit = await prisma.auditEvent.count({
      where: {
        actorId: user.id,
        action: "ACTION_PROPOSAL_APPLIED",
        objectId: appliedProposal.appliedObjectId!,
      },
    });
    assert.equal(proposalAudit, 1);
    console.log("  ✔ concurrent confirms resolved to one work item, one receipt, one apply audit");

    console.log("▶ G4 proposal lifecycle authorization: viewers cannot create or reject governance writes");
    await assert.rejects(
      createProposal(viewerSession, {
        actionType: "CREATE_WORK_ITEM",
        projectId: project.id,
        payload: {
          projectId: project.id,
          title: "viewer must not propose",
          target: "forbidden",
          deliverableReq: "none",
        },
        idempotencyKey: `viewer-proposal-${tag}`,
      }),
      (error: any) => error?.statusCode === 403
    );

    const latestVersion = await prisma.productVersion.findFirstOrThrow({
      where: { productId: product.id },
      orderBy: { createdAt: "desc" },
    });
    await assert.rejects(
      createProposal(viewerSession, {
        actionType: "UPDATE_FIELD",
        productId: product.id,
        payload: {
          productId: product.id,
          baseVersionId: latestVersion.id,
          field: "coreIdea",
          value: "viewer forbidden update",
        },
        idempotencyKey: `viewer-product-proposal-${tag}`,
      }),
      (error: any) => error?.statusCode === 403
    );

    const rejectTarget = await createProposal(session, {
      actionType: "CREATE_WORK_ITEM",
      projectId: project.id,
      payload: {
        projectId: project.id,
        title: "Owner-governed reject target",
        target: "authorization regression",
        deliverableReq: "none",
      },
      idempotencyKey: `reject-target-${tag}`,
    });

    await assert.rejects(
      rejectProposal(viewerSession, rejectTarget.proposalId, "viewer must not reject"),
      (error: any) => error?.statusCode === 403
    );
    const ownerRejected = await rejectProposal(
      session,
      rejectTarget.proposalId,
      "owner intentionally rejects"
    );
    assert.equal(ownerRejected.status, "REJECTED");
    assert.equal(ownerRejected.idempotent, false);

    const rejectAudit = await prisma.auditEvent.count({
      where: {
        actorId: user.id,
        action: "ACTION_PROPOSAL_REJECTED",
        objectId: rejectTarget.proposalId,
      },
    });
    assert.equal(rejectAudit, 1);
    console.log("  ✔ viewer proposal interference blocked; owner reject remains audited");

    console.log("▶ G5 ProfessionalAnalysis canonical storage + AgentRun finalization");
    const analysisVersion = await prisma.productVersion.findFirstOrThrow({
      where: { productId: product.id },
      orderBy: { createdAt: "desc" },
    });
    const agentRun = await prisma.agentRun.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        goal: "canonical professional analysis regression",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const analysisRunId = await analyzeProductVersion(session, {
      productId: product.id,
      productVersionId: analysisVersion.id,
      requestProfessionalAnalysis: true,
      agentRunId: agentRun.id,
    });

    const storedAnalysisRun = await prisma.analysisRun.findUniqueOrThrow({
      where: { id: analysisRunId },
      select: { inputSnapshot: true },
    });
    const snapshot = storedAnalysisRun.inputSnapshot as Record<string, any>;
    const professionalAnalysis = snapshot.professionalAnalysis as Record<string, any>;
    const professionalMeta = snapshot.professionalAnalysisMeta as Record<string, any>;

    assert.equal(typeof professionalAnalysis.schemaVersion, "string");
    assert.ok(
      ["PROCEED_TO_VALIDATE", "NEEDS_EVIDENCE", "PAUSE", "REJECT"].includes(
        professionalAnalysis.conclusion
      )
    );
    assert.ok(Array.isArray(professionalAnalysis.claims));
    assert.ok(Array.isArray(professionalAnalysis.risks));
    assert.ok(Array.isArray(professionalAnalysis.unknowns));
    assert.ok(Array.isArray(professionalAnalysis.recommendedActions));
    assert.ok(Array.isArray(professionalAnalysis.limitations));
    assert.equal("status" in professionalAnalysis, false);
    assert.equal("evidenceGaps" in professionalAnalysis, false);
    assert.equal(typeof professionalMeta.promptVersion, "string");
    assert.equal(typeof professionalMeta.isLLMGenerated, "boolean");

    const finalizedAgentRun = await prisma.agentRun.findUniqueOrThrow({
      where: { id: agentRun.id },
    });
    assert.equal(finalizedAgentRun.status, "SUCCEEDED");
    assert.ok(finalizedAgentRun.finishedAt);
    assert.equal(finalizedAgentRun.errorReason, null);
    console.log("  ✔ canonical V1 persisted; generation metadata separated; AgentRun finalized");

    console.log("\n✅ Governance convergence regression passed");
  } finally {
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: user.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: user.id } });
    await prisma.actionProposal.deleteMany({ where: { organizationId: org.id } });
    await prisma.agentRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.analysisRun.deleteMany({ where: { organizationId: org.id } });
    await prisma.projectMember.deleteMany({ where: { project: { organizationId: org.id } } });
    await prisma.project.deleteMany({ where: { organizationId: org.id } });
    await prisma.productVersion.deleteMany({ where: { product: { organizationId: org.id } } });
    await prisma.product.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("❌ Governance convergence regression failed:", error);
  try { await prisma.$disconnect(); } catch {}
  process.exitCode = 1;
});
