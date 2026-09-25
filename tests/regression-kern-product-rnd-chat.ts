import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole, Role } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { createDevelopmentProduct } from "../src/modules/products/service";
import { createConversation, sendMessage } from "../src/modules/advisor/service";

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

    const conversation = await createConversation(session, {
      title: "AKK 产品研发",
      productId: created.product.id,
    });

    console.log("▶ R1 explicit chat command starts the existing Product R&D orchestrator");
    const first = await sendMessage(
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
    const second = await sendMessage(
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

    const ambiguous = await sendMessage(
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
    const explicit = await sendMessage(
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
    const namedStatus = await sendMessage(
      session,
      conversation.id,
      `「${secondProject.title}」的产品研发进度怎么样`
    );
    assert.match(namedStatus.message.content, new RegExp(secondProject.title));
    assert.match(namedStatus.message.content, /研发工作项：/);
    assert.match(namedStatus.message.content, /Executive Report：尚未生成/);

    console.log("▶ R6 generic status fails closed when multiple projects both have R&D");
    const ambiguousStatus = await sendMessage(
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

    const reportReply = await sendMessage(
      session,
      conversation.id,
      "这个产品的研发报告结论、风险和需要我决定的事情是什么"
    );
    assert.match(reportReply.message.content, /AKK 渠道专项项目/);
    assert.match(reportReply.message.content, /当前方案可以继续验证，但法规边界与供应报价仍需补证/);
    assert.match(reportReply.message.content, /目标人群与渠道方向具备继续验证价值/);
    assert.match(reportReply.message.content, /供应商正式报价尚未锁定/);
    assert.match(reportReply.message.content, /黑姜原料在目标市场的法规边界仍需确认/);
    assert.match(reportReply.message.content, /是否按当前剂量方案进入下一轮样品验证/);
    assert.match(reportReply.message.content, /补齐法规证据/);

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
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
