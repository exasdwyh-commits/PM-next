import { ProjectMode, ProjectStage, GateType, DecisionPacketStatus, DecisionOutcome, Role, WorkExecutorType, WorkItemStatus } from "@prisma/client";
import { computeRequestHash, checkOrRecordIdempotency } from "../src/shared/idempotency";
import { createAuditEventInTx } from "../src/shared/audit";
import { assertTestDatabaseSafety } from "./test-safety";
import prisma from "../src/shared/db";
import { randomUUID } from "node:crypto";

const runTag = randomUUID();
let fixtureOrgId: string | undefined;

async function cleanupFixture() {
  if (!fixtureOrgId) return;
  const organizationId = fixtureOrgId;
  await prisma.$transaction(async tx => {
    const users = await tx.user.findMany({ where: { organizationId }, select: { id: true } });
    const actorId = { in: users.map(user => user.id) };
    await tx.idempotencyRecord.deleteMany({ where: { actorId } });
    await tx.auditEvent.deleteMany({ where: { actorId } });
    await tx.decision.deleteMany({ where: { packet: { project: { organizationId } } } });
    await tx.decisionPacket.deleteMany({ where: { project: { organizationId } } });
    await tx.workItem.deleteMany({ where: { project: { organizationId } } });
    await tx.projectMember.deleteMany({ where: { project: { organizationId } } });
    await tx.project.deleteMany({ where: { organizationId } });
    await tx.user.deleteMany({ where: { organizationId } });
    await tx.organization.delete({ where: { id: organizationId } });
  });
}

async function runVerification() {
  console.log("=== [1] Verifying PostgreSQL Connection & Environment ===");
  await assertTestDatabaseSafety(prisma);

  const dbInfo = await prisma.$queryRaw<Array<{ current_user: string; current_database: string; version: string }>>`
    SELECT current_user, current_database(), version()
  `;
  console.log("Database connected successfully:", {
    user: dbInfo[0].current_user,
    database: dbInfo[0].current_database,
    version: dbInfo[0].version.split(" ")[0] + " " + dbInfo[0].version.split(" ")[1],
  });

  console.log("\n=== [2] Seeding Base Entities (Org, Users, Project) ===");

  const org = await prisma.organization.create({
    data: {
      name: "赫尔墨斯食品创新实验室（测试）",
      code: `HERMES_TEST_ORG_${runTag}`,
    },
  });

  fixtureOrgId = org.id;
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `owner-${runTag}@hermes.test`,
      name: "项目负责人 (PM)",
    },
  });

  const decisionMaker = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `dm-${runTag}@hermes.test`,
      name: "指定决策人 (VP)",
    },
  });

  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      mode: ProjectMode.NEW_PRODUCT,
      title: "高多酚黑巧燕麦脆饮片（DEMO验证项目）",
      target: "验证健康代餐即食化品类可行性与打样成本",
      stage: ProjectStage.RESEARCH,
      ownerId: owner.id,
      decisionMakerId: decisionMaker.id,
    },
  });

  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: Role.OWNER },
      { projectId: project.id, userId: decisionMaker.id, role: Role.DECISION_MAKER },
    ],
  });

  console.log("Created Project:", { id: project.id, title: project.title, stage: project.stage });

  console.log("\n=== [3] A11 Verification: Multi-Entity Transaction Success Case ===");
  const scopeHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  
  const packet = await prisma.decisionPacket.create({
    data: {
      projectId: project.id,
      gate: GateType.RESEARCH_SAMPLING_GATE,
      artifactVersions: [{ type: "MARKET_OPPORTUNITY", version: 1 }],
      evidenceVersions: [{ id: "evi-test-1", hash: "sha256-demo" }],
      budgetAmount: 50000.0,
      budgetCurrency: "CNY",
      budgetScope: "仅限一期打样原料采购与初次实验室感官评测",
      validationPlan: "组织20人双盲口感评测，水分活性与多酚留存率测试",
      requiredChecks: { marketEvidenceChecked: true, budgetScopeDefined: true },
      scopeHash: scopeHash,
      status: DecisionPacketStatus.IN_REVIEW,
    },
  });

  // Execute approval transaction atomically
  const txResult = await prisma.$transaction(async (tx) => {
    // 1. Update DecisionPacket to APPROVED
    const updatedPacket = await tx.decisionPacket.update({
      where: { id: packet.id },
      data: { status: DecisionPacketStatus.APPROVED },
    });

    // 2. Insert Decision record (append-only)
    const decision = await tx.decision.create({
      data: {
        packetId: packet.id,
        actorId: decisionMaker.id,
        decision: DecisionOutcome.APPROVE,
        reason: "市场依据充分，5万打样预算清晰且限定在一期原料与感官评测范围内，准予推进打样准备",
        obligations: "打样后出具实验室水分与多酚质检报告",
      },
    });

    // 3. Update Project Stage from RESEARCH to SAMPLING
    const updatedProject = await tx.project.update({
      where: { id: project.id },
      data: {
        stage: ProjectStage.SAMPLING,
        revision: { increment: 1 },
      },
    });

    // 4. Create single next preparation WorkItem
    const nextWorkItem = await tx.workItem.create({
      data: {
        projectId: project.id,
        title: "打样准备与实验室原料备料",
        target: "落实第一期打样原料供应商采购并排期实验室样品试制",
        executorType: WorkExecutorType.HUMAN,
        status: WorkItemStatus.TODO,
        deliverableReq: "第一期原料采购清单及实验室试制确认单",
      },
    });

    // 5. Create AuditEvent
    const audit = await createAuditEventInTx(tx, {
      actorId: decisionMaker.id,
      action: "DECISION_PACKET_APPROVED",
      objectType: "DecisionPacket",
      objectId: packet.id,
      revision: updatedProject.revision,
      summary: `指定决策人批准研发打样门，项目阶段推进至 ${ProjectStage.SAMPLING}，自动建立打样准备任务`,
      details: {
        packetId: packet.id,
        decisionId: decision.id,
        newStage: ProjectStage.SAMPLING,
        nextWorkItemId: nextWorkItem.id,
      },
    });

    return { updatedPacket, decision, updatedProject, nextWorkItem, audit };
  });

  console.log("Transaction Committed Atomically:");
  console.log("- DecisionPacket Status:", txResult.updatedPacket.status);
  console.log("- Decision ID:", txResult.decision.id);
  console.log("- Project Stage:", txResult.updatedProject.stage, "(revision:", txResult.updatedProject.revision, ")");
  console.log("- Generated Next WorkItem:", txResult.nextWorkItem.title);
  console.log("- Audit Event ID:", txResult.audit.id);

  console.log("\n=== [4] A11 Verification: Transaction Rollback on Failure ===");
  // Create another packet to test rollback
  const packet2 = await prisma.decisionPacket.create({
    data: {
      projectId: project.id,
      gate: GateType.RESEARCH_SAMPLING_GATE,
      artifactVersions: [{ type: "MARKET_OPPORTUNITY", version: 2 }],
      evidenceVersions: [],
      budgetAmount: 20000.0,
      validationPlan: "二次打样验证",
      requiredChecks: {},
      scopeHash: "sha256-hash-2",
      status: DecisionPacketStatus.IN_REVIEW,
    },
  });

  const projectStageBeforeRollback = (await prisma.project.findUnique({ where: { id: project.id } }))!.stage;
  const workItemCountBefore = await prisma.workItem.count({ where: { projectId: project.id } });
  const auditCountBefore = await prisma.auditEvent.count({ where: { actorId: decisionMaker.id } });

  let rollbackCaught = false;
  try {
    await prisma.$transaction(async (tx) => {
      // Step 1: Update packet
      await tx.decisionPacket.update({
        where: { id: packet2.id },
        data: { status: DecisionPacketStatus.APPROVED },
      });

      // Step 2: Try to advance project stage
      await tx.project.update({
        where: { id: project.id },
        data: { stage: ProjectStage.PRODUCTION_PREP },
      });

      // Step 3: Deliberately throw an error mid-transaction
      throw new Error("SIMULATED_TRANSACTION_FAILURE: Simulated IO or business constraint breach");
    });
  } catch (err: any) {
    if (err.message.includes("SIMULATED_TRANSACTION_FAILURE")) {
      rollbackCaught = true;
    } else {
      throw err;
    }
  }

  if (!rollbackCaught) {
    throw new Error("Expected simulated transaction failure was not caught");
  }

  // Verify that NO partial state exists
  const packet2After = await prisma.decisionPacket.findUnique({ where: { id: packet2.id } });
  const projectAfter = await prisma.project.findUnique({ where: { id: project.id } });
  const workItemCountAfter = await prisma.workItem.count({ where: { projectId: project.id } });
  const auditCountAfter = await prisma.auditEvent.count({ where: { actorId: decisionMaker.id } });

  console.log("Rollback Verification Results:");
  console.log("- Packet status remained IN_REVIEW:", packet2After?.status === DecisionPacketStatus.IN_REVIEW);
  console.log("- Project stage remained intact:", projectAfter?.stage === projectStageBeforeRollback);
  console.log("- No orphan work items created:", workItemCountAfter === workItemCountBefore);
  console.log("- No partial audit records created:", auditCountAfter === auditCountBefore);

  if (
    packet2After?.status !== DecisionPacketStatus.IN_REVIEW ||
    projectAfter?.stage !== projectStageBeforeRollback ||
    workItemCountAfter !== workItemCountBefore ||
    auditCountAfter !== auditCountBefore
  ) {
    throw new Error("A11 Transaction rollback test FAILED: partial data found after failure!");
  }

  console.log("\n=== [5] Idempotency Key Storage & Replay Test ===");
  const idempotencyKey = `idemp-${runTag}`;
  const reqBody = { packetId: packet.id, decision: "APPROVE", reason: "Repeat check" };
  const reqHash = computeRequestHash(reqBody);

  const firstCall = await prisma.$transaction(async (tx) => {
    return checkOrRecordIdempotency(tx, idempotencyKey, decisionMaker.id, "DECIDE_GATE", reqHash, async () => {
      return { status: 200, body: { success: true, message: "Decided successfully" } };
    });
  });
  console.log("First Call:", { status: firstCall.status, wasReplayed: firstCall.wasReplayed });

  const replayCall = await prisma.$transaction(async (tx) => {
    return checkOrRecordIdempotency(tx, idempotencyKey, decisionMaker.id, "DECIDE_GATE", reqHash, async () => {
      throw new Error("This execute block should NOT be called during replay");
    });
  });
  console.log("Replay Call with same key & payload:", { status: replayCall.status, wasReplayed: replayCall.wasReplayed });

  let conflictCaught = false;
  try {
    const diffHash = computeRequestHash({ different: "payload" });
    await prisma.$transaction(async (tx) => {
      return checkOrRecordIdempotency(tx, idempotencyKey, decisionMaker.id, "DECIDE_GATE", diffHash, async () => {
        return { status: 200, body: { ok: true } };
      });
    });
  } catch (err: any) {
    if (err.name === "AppError" && err.code === "CONFLICT") {
      conflictCaught = true;
    }
  }
  console.log("Replay with different payload threw ConflictError (409):", conflictCaught);

  if (!firstCall || !replayCall.wasReplayed || !conflictCaught) {
    throw new Error("Idempotency test failed!");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL DATABASE & TRANSACTION VERIFICATION TESTS PASSED!");
  console.log("=======================================================\n");
}

runVerification()
  .catch((err) => {
    console.error("Verification failed with error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupFixture();
    } catch (error) {
      console.error("Fixture cleanup failed", error);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  });
