import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole, Role } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { createDevelopmentProduct } from "../src/modules/products/service";
import { createKernConversation, sendDepartmentAssistantMessage } from "../src/modules/assistant-runtime";
import {
  isExecutiveReportCitation,
  readExecutiveReportStats,
} from "../src/shared/executive-report-citation";
import { getExecutiveReportView } from "../src/modules/product-rnd/report-view";

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Kern R&D Chat Test", code: "KERN_RND_" + tag },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "kern-rnd-" + tag + "@hermes.test",
      name: "Kern R&D Owner",
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: OrgRole.ORG_ADMIN,
    },
  });

  const session = {
    userId: user.id,
    organizationId: org.id,
    userEmail: user.email,
    userName: user.name,
  };

  try {
    await bootstrapDefaultWorkforce(session);

    const created = await createDevelopmentProduct(session, {
      name: "AKK 轻体产品",
      coreIdea: "围绕肠道舒适与体重稳定的女性精准营养产品",
      targetAudience: "25-45 岁女性",
      coreSellingPoints: "肠道舒适、排便顺畅、体重管理",
      targetChannels: "私域与电商",
      sourceKind: "MANUAL",
    });

    const conversation = await createKernConversation(session, {
      title: "AKK 产品研发",
      productId: created.product.id,
    });

    console.log("▶ R1 explicit chat command starts the existing Product R&D orchestrator");
    const first = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "启动这个产品的 AI 产品研发，按现有方案做完整评估"
    );

    assert.match(first.message.content, /已启动真实 Product R&D 程序/);

    const rndItemsAfterFirst = await prisma.workItem.findMany({
      where: {
        projectId: created.project.id,
        title: "产品研发综合评估",
      },
      select: { id: true, status: true },
    });
    assert.equal(rndItemsAfterFirst.length, 1, "首次显式启动应创建且只创建一套 R&D 工作项");

    const researchAfterFirst = await prisma.researchRun.findMany({
      where: { projectId: created.project.id },
      select: { id: true, status: true },
    });
    assert.equal(researchAfterFirst.length, 1, "首次启动应创建真实 ResearchRun");

    const parentTasks = await prisma.agentTask.findMany({
      where: {
        workItemId: rndItemsAfterFirst[0].id,
        parentTaskId: null,
      },
      select: { id: true, status: true },
    });
    assert.equal(parentTasks.length, 1, "R&D 应有一条真实父 AgentTask");

    console.log("▶ R2 repeating the same command reuses the active program");
    const second = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "继续推进这个产品的产品研发"
    );
    assert.match(second.message.content, /已经有一套正在推进的产品研发程序/);

    const rndItemsAfterSecond = await prisma.workItem.count({
      where: {
        projectId: created.project.id,
        title: "产品研发综合评估",
      },
    });
    assert.equal(rndItemsAfterSecond, 1, "重复指令不得创建第二套 active Product R&D");

    console.log("▶ R3 multiple linked projects never cause Kern to guess");
    const secondProject = await prisma.project.create({
      data: {
        organizationId: org.id,
        mode: "NEW_PRODUCT",
        title: "AKK 渠道专项项目",
        target: "验证渠道专项方案",
        stage: "RESEARCH",
        productId: created.product.id,
        productVersionId: created.version.id,
        ownerId: user.id,
      },
    });
    await prisma.projectMember.create({
      data: {
        projectId: secondProject.id,
        userId: user.id,
        role: Role.OWNER,
      },
    });

    const ambiguous = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "启动产品研发"
    );
    assert.match(ambiguous.message.content, /关联了 2 个项目/);
    assert.match(ambiguous.message.content, /没有猜要在哪一个项目启动研发/);

    const secondProjectBefore = await prisma.workItem.count({
      where: {
        projectId: secondProject.id,
        title: "产品研发综合评估",
      },
    });
    assert.equal(secondProjectBefore, 0, "多项目且未点名时不得偷偷启动任何新项目");

    console.log("▶ R4 naming the project explicitly selects exactly that project");
    const explicit = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      `在「${secondProject.title}」启动产品研发`
    );
    assert.match(explicit.message.content, new RegExp(secondProject.title));
    assert.match(explicit.message.content, /已启动真实 Product R&D 程序/);

    const secondProjectAfter = await prisma.workItem.count({
      where: {
        projectId: secondProject.id,
        title: "产品研发综合评估",
      },
    });
    assert.equal(secondProjectAfter, 1);


    console.log("▶ R5 status query reads real Product R&D state without executing");
    const namedStatus = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      `「${secondProject.title}」的产品研发进度怎么样`
    );
    assert.match(namedStatus.message.content, new RegExp(secondProject.title));
    assert.match(namedStatus.message.content, /研发工作项：/);
    assert.match(namedStatus.message.content, /Executive Report：尚未生成/);

    console.log("▶ R6 generic status fails closed when multiple projects both have R&D");
    const ambiguousStatus = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "这个产品研发进度怎么样"
    );
    assert.match(ambiguousStatus.message.content, /有多个项目存在 Product R&D 记录/);
    assert.match(ambiguousStatus.message.content, /我没有猜要看哪一个/);


    console.log("▶ R7 persisted Executive Report can be read directly from Kern");
    const secondRndWorkItem = await prisma.workItem.findFirstOrThrow({
      where: {
        projectId: secondProject.id,
        title: "产品研发综合评估",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const reportArtifact = await prisma.artifact.create({
      data: {
        organizationId: org.id,
        productVersionId: created.version.id,
        workItemId: secondRndWorkItem.id,
        type: "PRODUCT_RND_EXECUTIVE_REPORT",
        title: "AKK 渠道专项产品研发报告",
        schemaVersion: "product-rnd-executive-report/v1",
        contentVersion: 1,
        producerType: "AI",
        inputRevision: 1,
        reviewStatus: "ACCEPTED",
        content: JSON.stringify({
          summary: "当前方案可以继续验证，但法规边界与供应报价仍需补证。",
          verificationStatus: "VERIFIED_WITH_GAPS",
          conclusions: [
            {
              claim: "目标人群与渠道方向具备继续验证价值",
              claimKind: "INFERENCE",
              evidenceLevel: "B",
              evidenceRef: "evidence:test-demand",
              verificationRefs: ["verification:test-demand"],
              freshness: "CURRENT",
            },
          ],
          unknowns: ["黑姜原料在目标市场的法规边界仍需确认"],
          risks: ["供应商正式报价尚未锁定"],
          decisionsRequired: ["是否按当前剂量方案进入下一轮样品验证"],
          recommendedActions: ["补齐法规证据", "锁定供应商正式报价"],
          assumptions: [],
          advisoryNotes: [],
          sourceRefs: [],
          agentRunRefs: [],
          modelRunRefs: [],
          knowledgeDebtRefs: [],
        }),
      },
    });

    const beforeReportQueryItems = await prisma.workItem.count({
      where: { projectId: secondProject.id },
    });

    const reportReply = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "这个产品的研发报告结论、风险和需要我决定的事情是什么"
    );
    assert.match(reportReply.message.content, /AKK 渠道专项项目/);
    assert.match(reportReply.message.content, /当前方案可以继续验证，但法规边界与供应报价仍需补证/);
    // 交付形态：对话里只回 headline 数字 + 报告页链接 + 结构化引用，全文不贴进对话
    // （见 src/shared/executive-report-citation.ts 顶部说明）。
    assert.match(
      reportReply.message.content,
      /依据 1 条（已核实 1 条）· 风险 1 项 · UNKNOWN 1 项 · 待决策 1 项/
    );
    assert.match(
      reportReply.message.content,
      new RegExp(`/reports/${reportArtifact.id}`),
      "对话必须给出指向这一份报告的站内链接"
    );

    // 结构化引用必须随消息落库：/muse 靠它渲出缩略图卡片，缺了卡片就出不来。
    const reportReplyCitations: unknown[] = Array.isArray(reportReply.message.citations)
      ? (reportReply.message.citations as unknown[])
      : [];
    const reportCitations = reportReplyCitations.filter(isExecutiveReportCitation);
    // 同一份报告只能出现一条引用：结构化那条与 legacy artifact 那条并存时，
    // 客户端「按标题匹配」会先拿到旧那条（没有 contentVersion/stats），
    // 于是卡片渲染出 undefined —— 这正是 Experience CI 2026-10-12 的红点。
    assert.equal(reportCitations.length, 1, "报告引用必须唯一：只保留 kind=executive-report 的结构化那一份");
    const reportCitation = reportCitations[0];
    assert.ok(reportCitation, "对话必须带上 Executive Report 结构化引用");
    assert.equal(reportCitation.kind, "executive-report");
    assert.equal(reportCitation.ref, reportArtifact.id);
    assert.equal(reportCitation.contentVersion, 1);
    assert.equal(reportCitation.reviewStatus, "ACCEPTED");
    assert.deepEqual(
      readExecutiveReportStats(reportCitation),
      { conclusions: 1, verified: 1, risks: 1, unknowns: 1, decisions: 1 },
      "卡片数字必须来自真实载荷，不得凭空生成"
    );

    // 全文仍可从 Kern 直接读到 —— 走 /reports/[id] 与 /api/reports/[id] 共用的装配函数，
    // 即「报告页上看得见的内容」与「测试断言的内容」是同一份数据。
    const reportView = await getExecutiveReportView(session, reportArtifact.id);
    assert.ok(reportView, "报告视图装配必须成功");
    assert.equal(reportView.report.artifactId, reportArtifact.id);
    assert.equal(reportView.reviewStatus, "ACCEPTED");
    assert.ok(
      (reportView.report.conclusions ?? []).some(
        (item) => item.claim === "目标人群与渠道方向具备继续验证价值"
      ),
      "结论必须能在报告视图里读到"
    );
    assert.ok(
      (reportView.report.risks ?? []).includes("供应商正式报价尚未锁定"),
      "风险必须能在报告视图里读到"
    );
    assert.ok(
      (reportView.report.unknowns ?? []).includes("黑姜原料在目标市场的法规边界仍需确认"),
      "UNKNOWN 必须能在报告视图里读到"
    );
    assert.ok(
      (reportView.report.decisionsRequired ?? []).includes("是否按当前剂量方案进入下一轮样品验证"),
      "待决策必须能在报告视图里读到"
    );
    assert.ok(
      (reportView.report.recommendedActions ?? []).includes("补齐法规证据"),
      "建议动作必须能在报告视图里读到"
    );

    const afterReportQueryItems = await prisma.workItem.count({
      where: { projectId: secondProject.id },
    });
    assert.equal(
      afterReportQueryItems,
      beforeReportQueryItems,
      "读取研发报告不得创建新的工作项或推进执行"
    );

    const storedReport = await prisma.artifact.findUniqueOrThrow({
      where: { id: reportArtifact.id },
      select: { id: true, reviewStatus: true },
    });
    assert.equal(storedReport.reviewStatus, "ACCEPTED");

    console.log("✅ Kern 显式启动 Product R&D：单项目直达、重复幂等、多项目不猜、点名可执行");
  } finally {
    await prisma.auditEvent.deleteMany({ where: { actorId: user.id } }).catch(() => {});
    await prisma.idempotencyRecord.deleteMany({ where: { actorId: user.id } }).catch(() => {});
    // R1 会真实创建 ResearchRun，而它到 User 的外键没有级联删除：
    // 不先清掉，删组织时会以 `ResearchRun_createdById_fkey` 违约告终，留下一堆孤儿夹具。
    await prisma.researchRun.deleteMany({ where: { createdById: user.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
