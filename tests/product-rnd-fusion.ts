import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AgentTaskStatus,
  EvidenceNature,
  EvidenceVerifyStatus,
  OrgRole,
  Role,
} from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce, finishAgentTask, startAgentTask } from "../src/modules/workforce/service";
import {
  queueProductRndQa,
  startProductRndProgram,
  synthesizeProductRndExecutiveReport,
} from "../src/modules/product-rnd";
import { runResearchRunTasks } from "../src/modules/research/research-run";
import { verifyEvidenceClaim } from "../src/modules/evidence/verification-service";
import { createOrMergeKnowledgeDebt } from "../src/modules/knowledge/knowledge-debt";
import { readStructuredArtifact } from "../src/modules/work/structured-artifacts";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Product R&D Fusion Test", code: "PRDF_" + tag },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `prdf-${tag}@hermes.test`,
      name: "Product R&D Owner",
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN },
  });

  const session = {
    userId: owner.id,
    organizationId: org.id,
    userEmail: owner.email,
    userName: owner.name,
  };

  try {
    await bootstrapDefaultWorkforce(session);

    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        title: "女性餐前轻体饮",
        target: "评估市场、配方、成本和法规是否具备进入打样的条件",
        constraints: "不把模型意见当事实；关键合规和功效结论必须有证据",
        ownerId: owner.id,
      },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: owner.id, role: Role.OWNER },
    });

    console.log("▶ PRD-F1 start one governed Product R&D program");
    const program = await startProductRndProgram(session, {
      projectId: project.id,
      brief:
        "开发一个面向25-45岁女性的餐前轻体饮，重点评估市场、AOS/膳食纤维配方、成本和中国法规。",
    });
    assert.equal(program.workItem.executorType, "DIGITAL_WORKER");
    assert.equal(program.specialistTasks.length, 5);
    assert.deepEqual(
      new Set(program.specialistTasks.map((item) => item.code)),
      new Set([
        "research_agent",
        "scientific_evidence_agent",
        "formulation_agent",
        "compliance_agent",
        "cost_bom_agent",
      ])
    );
    assert.ok(program.researchRun.id);
    assert.equal(program.parentTask.status, AgentTaskStatus.RUNNING);
    assert.equal(program.parentRun.status, "RUNNING");

    console.log("▶ PRD-F2 specialists finish with durable AgentRun summaries");
    for (const item of program.specialistTasks) {
      const started = await startAgentTask(session, item.task.id);
      const finished = await finishAgentTask(session, item.task.id, {
        runId: started.run.id,
        outcome: "SUCCEEDED",
        resultSummary:
          `${item.label}已完成：保留来源边界、UNKNOWN 与待补证据，不把假设升级为业务事实。`,
      });
      assert.equal(finished.task.status, AgentTaskStatus.SUCCEEDED);
    }

    console.log("▶ PRD-F3 independent QA is auto-queued after specialists finish");
    let qaTask = await prisma.agentTask.findFirst({
      where: {
        parentTaskId: program.parentTask.id,
        agent: { code: "qa_verifier" },
      },
      include: { agent: true },
    });
    if (!qaTask) {
      await queueProductRndQa(session, {
        parentTaskId: program.parentTask.id,
      });
      qaTask = await prisma.agentTask.findFirst({
        where: {
          parentTaskId: program.parentTask.id,
          agent: { code: "qa_verifier" },
        },
        include: { agent: true },
      });
    }
    assert.ok(qaTask);
    const qaStarted = await startAgentTask(session, qaTask.id);
    const qaFinished = await finishAgentTask(session, qaTask.id, {
      runId: qaStarted.run.id,
      outcome: "SUCCEEDED",
      resultSummary:
        "QA完成：未发现执行 Agent 自证；未闭合项继续保留 UNKNOWN，报告可提交负责人审查。",
    });
    assert.equal(qaFinished.task.status, AgentTaskStatus.SUCCEEDED);

    console.log("▶ PRD-F4 run existing ResearchRun and attach independent claim verification");
    await runResearchRunTasks(program.researchRun.id);

    const evidence = await prisma.evidence.create({
      data: {
        projectId: project.id,
        contentOrUri: "https://www.fda.gov/example",
        source: "FDA",
        author: "FDA",
        hash: "a".repeat(64),
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.VERIFIED,
        sourceType: "OFFICIAL",
        trustTier: "OFFICIAL",
        dataClass: "PUBLIC",
        fetchedAt: new Date(),
        sourceOrganization: "FDA",
        claims: {
          create: {
            fieldKey: "regulatoryExample",
            fieldName: "法规示例事实",
            kind: "FACT",
            value: "FDA approved product X on September 24 2026.",
          },
        },
      },
      include: { claims: true },
    });

    const capture = await prisma.evidenceSourceCapture.create({
      data: {
        evidenceId: evidence.id,
        sourceUri: "https://www.fda.gov/example",
        sourceType: "OFFICIAL",
        trustTier: "OFFICIAL",
        sourceOrganization: "FDA",
        httpStatus: 200,
        contentHash: "b".repeat(64),
        rawContentPreview:
          "Official notice: FDA approved product X on September 24 2026. Additional context follows.",
        injectionStatus: "CLEAN",
        fetchedAt: new Date(),
        fetcherIdentity: "independent_verifier",
        remoteAddress: "93.184.216.34",
        contentType: "text/plain",
        redirectCount: 0,
      },
    });

    const verified = await verifyEvidenceClaim(session, {
      evidenceClaimId: evidence.claims[0].id,
      sourceCaptureIds: [capture.id],
    });
    assert.equal(verified.claim.evidenceLevel, "SUPPORTED");

    await prisma.dataGap.create({
      data: {
        projectId: project.id,
        fieldKey: "realSupplierQuote",
        fieldName: "真实供应商报价",
        description: "尚未取得当前规格与 MOQ 下的真实工厂报价",
      },
    });
    await createOrMergeKnowledgeDebt({
      organizationId: org.id,
      projectId: project.id,
      topic: "餐前轻体饮当前宣称边界",
      reason: "需要补充正式法规与渠道口径后才能固化为公司知识",
      importance: "HIGH",
      suggestedExpertClass: "COMPLIANCE",
    });

    console.log("▶ PRD-F5 QA completion auto-synthesizes governed executive Artifact");
    let autoArtifact = await prisma.artifact.findFirst({
      where: {
        workItemId: program.workItem.id,
        type: "PRODUCT_RND_EXECUTIVE_REPORT",
      },
      orderBy: { createdAt: "desc" },
    });
    if (!autoArtifact) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      autoArtifact = await prisma.artifact.findFirst({
        where: {
          workItemId: program.workItem.id,
          type: "PRODUCT_RND_EXECUTIVE_REPORT",
        },
        orderBy: { createdAt: "desc" },
      });
    }
    assert.ok(autoArtifact);

    const synthesized = await synthesizeProductRndExecutiveReport(session, {
      projectId: project.id,
      workItemId: program.workItem.id,
      parentTaskId: program.parentTask.id,
    });
    assert.ok(synthesized.artifact);
    assert.equal(synthesized.artifact?.type, "PRODUCT_RND_EXECUTIVE_REPORT");
    assert.equal(synthesized.artifact?.producerType, "AI");
    assert.equal(synthesized.artifact?.schemaVersion, "1.0");
    assert.equal(synthesized.report.verificationStatus, "READY_FOR_HUMAN_REVIEW");
    assert.ok(
      synthesized.report.conclusions.some(
        (claim) => claim.evidenceLevel === "SUPPORTED"
      )
    );
    assert.ok(
      synthesized.report.unknowns.some((item) =>
        item.includes("真实供应商报价")
      )
    );
    assert.ok(
      synthesized.report.knowledgeDebtRefs.length >= 1
    );

    const read = readStructuredArtifact({
      type: synthesized.artifact!.type,
      content: synthesized.artifact!.content,
      schemaVersion: synthesized.artifact!.schemaVersion,
    });
    assert.equal(read.kind, "structured");
    if (read.kind === "structured") {
      assert.equal(
        read.value.verificationStatus,
        "READY_FOR_HUMAN_REVIEW"
      );
      assert.equal(read.value.dataNature, "REAL");
    }

    const savedWork = await prisma.workItem.findUniqueOrThrow({
      where: { id: program.workItem.id },
    });
    assert.equal(savedWork.status, "SUBMITTED");
    const savedParent = await prisma.agentTask.findUniqueOrThrow({
      where: { id: program.parentTask.id },
    });
    assert.equal(savedParent.status, AgentTaskStatus.SUCCEEDED);
    assert.equal(
      await prisma.artifact.count({
        where: {
          workItemId: program.workItem.id,
          type: "PRODUCT_RND_EXECUTIVE_REPORT",
        },
      }),
      1
    );

    console.log("\n✅ Product R&D fusion vertical slice passed");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
