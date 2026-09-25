import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createConversation, sendMessage } from "../src/modules/advisor/service";
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
    const conversation = await createConversation(session, {
      title: "AKK 新产品讨论",
      productId: null,
    });

    const first = await sendMessage(
      session,
      conversation.id,
      "我想做一款给 25-45 岁女性的餐前轻体饮"
    );
    assert.equal(first.proposal, null, "第一句只应累积草稿，不应提前写产品");

    const second = await sendMessage(
      session,
      conversation.id,
      [
        "名称：轻盈餐前饮",
        "目标人群与场景：25-45 岁女性，正餐前使用",
        "核心卖点：餐前轻负担与肠道舒适",
        "预期渠道：私域与电商",
      ].join("\n")
    );

    assert.equal(second.proposal?.actionType, "CREATE_PRODUCT");
    assert.ok(second.proposal?.proposalId, "补齐字段后必须产生待确认新产品提议");

    const beforeConfirm = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { productId: true, kind: true },
    });
    assert.equal(beforeConfirm.productId, null, "确认前不能偷偷绑定或创建业务产品");

    console.log("▶ K2 confirming CREATE_PRODUCT atomically binds the original conversation");
    const receipt = await applyProposal(
      session,
      second.proposal!.proposalId,
      {
        idempotencyKey: "kern-continuity-" + tag,
        reason: "回归测试：确认新产品并继续原会话",
      }
    );

    assert.equal(receipt.status, "APPLIED");
    assert.equal(receipt.appliedObjectType, "Product");
    assert.ok(receipt.appliedObjectId);

    const productId = receipt.appliedObjectId!;
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
    const third = await sendMessage(
      session,
      conversation.id,
      "把目标人群改成 25-45 岁轻体女性"
    );
    assert.equal(third.proposal?.actionType, "UPDATE_FIELD");
    assert.ok(third.proposal?.proposalId);

    const fieldProposal = await prisma.actionProposal.findUniqueOrThrow({
      where: { id: third.proposal!.proposalId },
      select: {
        productId: true,
        conversationId: true,
        status: true,
      },
    });
    assert.equal(fieldProposal.productId, productId);
    assert.equal(fieldProposal.conversationId, conversation.id);
    assert.equal(fieldProposal.status, "PENDING_CONFIRMATION");

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { targetAudience: true },
    });
    assert.equal(
      product.targetAudience,
      "25-45 岁女性，正餐前使用",
      "字段修改在用户再次确认前不能直接写入业务产品"
    );

    console.log("✅ Kern 新产品 → 确认 → 原会话继续产品工作的主链连续");
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
