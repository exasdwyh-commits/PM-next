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
import {
  bootstrapDefaultWorkforce,
  delegateAgentTask,
  finishAgentTask,
  startAgentTask,
} from "../src/modules/workforce/service";
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

    const retried = await startProductRndProgram(session, {
      projectId: project.id,
      brief:
        "同一次请求重试：开发一个面向25-45岁女性的餐前轻体饮，评估市场、配方、成本和法规。",
    });
    assert.equal(retried.reused, true);
    assert.equal(retried.workItem.id, program.workItem.id);
    assert.equal(
      await prisma.workItem.count({
        where: {
          projectId: project.id,
          title: "产品研发综合评估",
          executorType: "DIGITAL_WORKER",
          status: { in: ["TODO", "RUNNING", "SUBMITTED", "CHANGES_REQUESTED"] },
        },
      }),
      1
    );
    assert.equal(
      await prisma.agentTask.count({
        where: {
          workItemId: program.workItem.id,
          parentTaskId: null,
          agent: { code: "hermes_pm" },
        },
      }),
      1
    );

    console.log("▶ PRD-F2 specialists finish with durable AgentRun summaries");
    for (const item of program.specialistTasks) {
      const started = await startAgentTask(session, item.task.id);
      if (item.code === "research_agent") {
        await runResearchRunTasks(program.researchRun.id);
      }
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

    console.log("▶ PRD-F4 attach durable independent claim verification before QA");

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

    console.log(
      "▶ PRD-F4b 注入报告诚实性 fixture（无回执的成功任务 + 未获支撑的 claim）"
    );

    // 注入 1：一个被标记 SUCCEEDED、但**没有任何 AgentRun 回执**的子任务。
    // 真实场景：任务状态被直接改写、或执行留痕丢失。报告必须点名它，
    // 而不是把它混进「已汇总 N 个数字员工任务」里当成正常产出。
    const redTeam = await prisma.agent.findUniqueOrThrow({
      where: {
        organizationId_code: { organizationId: org.id, code: "red_team" },
      },
      select: { id: true },
    });
    const receiptlessDelegation = await delegateAgentTask(session, {
      parentTaskId: program.parentTask.id,
      toAgentId: redTeam.id,
      goal: "报告诚实性测试注入：标记成功但不留 AgentRun 回执的子任务。",
      reason:
        "Regression fixture: a succeeded task without a run receipt must surface as an unresolved item.",
      sourceRunId: null,
    });
    // 直接用状态字段改写成 SUCCEEDED（不走 finishAgentTask，因此不会产生 AgentRun）——
    // 这正是「成功但没有执行留痕」这一被守护的状态。
    await prisma.agentTask.update({
      where: { id: receiptlessDelegation.childTask.id },
      data: { status: AgentTaskStatus.SUCCEEDED },
    });
    const receiptlessRuns = await prisma.agentRun.count({
      where: { agentTaskId: receiptlessDelegation.childTask.id },
    });
    assert.equal(receiptlessRuns, 0, "注入任务必须确实没有 AgentRun 回执");

    // 注入 2：一个 claim，其**最新一次核验不是 SUPPORTED**（抓取内容里根本没有该命题）。
    const unsupportedEvidence = await prisma.evidence.create({
      data: {
        projectId: project.id,
        contentOrUri: "https://www.fda.gov/example-2",
        source: "FDA",
        author: "FDA",
        hash: "c".repeat(64),
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.VERIFIED,
        sourceType: "OFFICIAL",
        trustTier: "OFFICIAL",
        dataClass: "PUBLIC",
        fetchedAt: new Date(),
        sourceOrganization: "FDA",
        claims: {
          create: {
            fieldKey: "unsupportedClaimProbe",
            fieldName: "未获支撑的命题",
            kind: "FACT",
            value: "本产品可在 7 天内让体脂下降 5%。",
          },
        },
      },
      include: { claims: true },
    });
    const unsupportedCapture = await prisma.evidenceSourceCapture.create({
      data: {
        evidenceId: unsupportedEvidence.id,
        sourceUri: "https://www.fda.gov/example-2",
        sourceType: "OFFICIAL",
        trustTier: "OFFICIAL",
        sourceOrganization: "FDA",
        httpStatus: 200,
        contentHash: "d".repeat(64),
        // 抓取内容刻意**不包含**该 claim 的文本 → 核验结果应为 NOT_FOUND
        rawContentPreview:
          "Official page describing unrelated labelling requirements. No mention of body-fat claims.",
        injectionStatus: "CLEAN",
        fetchedAt: new Date(),
        fetcherIdentity: "independent_verifier",
        remoteAddress: "93.184.216.35",
        contentType: "text/plain",
        redirectCount: 0,
      },
    });
    await verifyEvidenceClaim(session, {
      evidenceClaimId: unsupportedEvidence.claims[0].id,
      sourceCaptureIds: [unsupportedCapture.id],
    });
    const latestVerification = await prisma.evidenceVerification.findFirst({
      where: { evidenceClaimId: unsupportedEvidence.claims[0].id },
      orderBy: { checkedAt: "desc" },
    });
    assert.equal(
      latestVerification?.supportStatus,
      "NOT_FOUND",
      "注入的 claim 最新核验必须是 NOT_FOUND（未获来源支撑）"
    );

    const qaStarted = await startAgentTask(session, qaTask.id);
    const qaFinished = await finishAgentTask(session, qaTask.id, {
      runId: qaStarted.run.id,
      outcome: "SUCCEEDED",
      resultSummary:
        "QA完成：已核对证据、UNKNOWN、专业边界和来源独立性；报告可提交负责人审查。",
    });
    assert.equal(qaFinished.task.status, AgentTaskStatus.SUCCEEDED);

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
    assert.ok(synthesized.report);
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

    // PRD-F4b 注入的两个诚实性 fixture 必须出现在报告里，且同时进 unknowns 与 risks。
    assert.ok(
      synthesized.report.unknowns.some(
        (item) => item.includes("没有 AgentRun 回执")
      ),
      "标记成功但无执行回执的任务必须列为未闭合项"
    );
    assert.ok(
      synthesized.report.unknowns.some(
        (item) =>
          item.includes("缺少 SUPPORTED 来源验证") && item.includes("NOT_FOUND")
      ),
      "最新核验非 SUPPORTED 的 claim 必须列为未闭合项"
    );
    assert.ok(
      synthesized.report.risks.some((item) => item.includes("无 AgentRun 回执")),
      "无回执任务必须同时产生风险条目"
    );
    assert.ok(
      synthesized.report.risks.some((item) =>
        item.includes("最新核验非 SUPPORTED")
      ),
      "未获支撑的结论必须同时产生风险条目"
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
    // 清理必须按 FK 安全顺序进行：多个模型对 User 的关系没有级联删除
    // （AuditEvent.actor / ResearchRun.createdBy / WorkSubmission.submittedBy /
    //   AgentRun.user / AnalysisRun.createdBy），必须先删子表再删组织。
    const orgUsers = await prisma.user
      .findMany({ where: { organizationId: org.id }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    const orgUserIds = orgUsers.map((row) => row.id);
    await prisma.workSubmission
      .deleteMany({ where: { workItem: { project: { organizationId: org.id } } } })
      .catch(() => {});
    await prisma.auditEvent
      .deleteMany({ where: { actorId: { in: orgUserIds } } })
      .catch(() => {});
    await prisma.researchRun
      .deleteMany({ where: { createdById: { in: orgUserIds } } })
      .catch(() => {});
    await prisma.agentRun
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => {});
    await prisma.analysisRun
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => {});
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
