import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createKernConversation, sendDepartmentAssistantMessage } from "../src/modules/assistant-runtime";
import { applyProposal } from "../src/modules/advisor/proposals";

async function main() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Explicit test database required");
  }
  await assertTestDatabaseSafety(prisma);

  const tag = randomUUID();
  const org = await prisma.organization.create({
    data: { name: "Kern Continuity Test", code: "KERN_CONT_" + tag },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: "kern-cont-" + tag + "@hermes.test",
      name: "Kern Continuity Owner",
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
    console.log("▶ K1 create a new product from one Kern conversation");
    const conversation = await createKernConversation(session, {
      title: "AKK 新产品讨论",
      productId: null,
    });

    const first = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "我想做一款给 25-45 岁女性的餐前轻体饮"
    );
    assert.equal(first.proposal, null, "第一句只应累积草稿，不应提前写产品");

    const second = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      [
        "名称：轻盈餐前饮",
        "目标人群与场景：25-45 岁女性，正餐前使用",
        "核心卖点：餐前轻负担与肠道舒适",
        "预期渠道：私域与电商",
      ].join("\n")
    );

    // 契约（intake 确认门，与风险分级正交）：CREATE_PRODUCT 在对话里不自动落库——
    // 建产品连带初始版本与项目，用户先看到整理出来的内容再决定。明确指令整理成
    // PENDING_CONFIRMATION 提议，等既有确认入口批准后才写业务数据。
    assert.equal(second.proposal?.actionType, "CREATE_PRODUCT", "明确的新产品指令整理成待确认提议");
    assert.equal(second.proposal?.created, true);
    assert.equal(
      (
        await prisma.actionProposal.findUniqueOrThrow({
          where: { id: second.proposal!.proposalId },
          select: { status: true },
        })
      ).status,
      "PENDING_CONFIRMATION",
      "确认之前不创建产品",
    );

    console.log("▶ K2 explicit CREATE_PRODUCT is applied once and binds the original conversation");
    // 用户在既有确认入口批准：与服务端确认同一路径，此后才写业务数据。
    const receipt = await applyProposal(session, second.proposal!.proposalId, {
      idempotencyKey: `kern-continuity-${tag}`,
    });
    assert.ok(receipt);
    const productProposal = await prisma.actionProposal.findFirstOrThrow({
      where: {
        conversationId: conversation.id,
        actionType: "CREATE_PRODUCT",
      },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        appliedObjectType: true,
        appliedObjectId: true,
      },
    });
    assert.equal(productProposal.status, "APPLIED");
    assert.equal(productProposal.appliedObjectType, "Product");
    assert.ok(productProposal.appliedObjectId);

    const productId = productProposal.appliedObjectId!;
    const bound = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { productId: true, kind: true },
    });
    assert.equal(bound.productId, productId);
    assert.equal(bound.kind, "PRODUCT");

    const createdProject = await prisma.project.findFirst({
      where: { organizationId: org.id, productId },
      select: { id: true, productId: true },
    });
    assert.ok(createdProject, "确认后应沿既有业务命令同时创建产品项目");

    console.log("▶ K3 the next sentence continues against the same product context");
    const third = await sendDepartmentAssistantMessage(
      session,
      conversation.id,
      "把目标人群改成 25-45 岁轻体女性"
    );
    assert.equal(third.proposal, null, "明确字段修改不应要求第二次确认");

    const fieldProposal = await prisma.actionProposal.findFirstOrThrow({
      where: {
        conversationId: conversation.id,
        actionType: "UPDATE_FIELD",
      },
      orderBy: { createdAt: "desc" },
      select: {
        productId: true,
        conversationId: true,
        status: true,
        appliedObjectType: true,
        appliedObjectId: true,
      },
    });
    assert.equal(fieldProposal.productId, productId);
    assert.equal(fieldProposal.conversationId, conversation.id);
    assert.equal(fieldProposal.status, "APPLIED");
    assert.equal(fieldProposal.appliedObjectType, "ProductVersion");
    assert.ok(fieldProposal.appliedObjectId);

    const latest = await prisma.productVersion.findFirstOrThrow({
      where: { productId },
      orderBy: { createdAt: "desc" },
      select: { specs: true },
    });
    assert.equal(
      (latest.specs as Record<string, unknown>).targetAudience,
      "25-45 岁轻体女性",
      "明确字段修改应通过版本化业务命令直接应用"
    );

    console.log("✅ Kern 新产品 → 自动执行 → 原会话继续工作的主链连续");
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
