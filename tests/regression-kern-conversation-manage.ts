/**
 * E2a · 会话管理（重命名 / 归档 / 恢复）— DB 回归。
 * - 归档后默认列表不再返回，恢复后重新可见（archivedAt null 过滤语义）；
 * - 重命名空串回落「新对话」；
 * - 归属校验：跨组织 / 他人会话一律 NotFound（不泄漏存在性）；
 * - 同组织他人会话即使同名也不可被改名/归档（owner 校验不靠标题）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import {
  archiveKernConversation,
  createKernConversation,
  listKernConversations,
  renameKernConversation,
} from "../src/modules/assistant-runtime";
import { NotFoundError } from "../src/shared/errors";

async function expectNotFound(promise: Promise<unknown>, label: string) {
  try {
    await promise;
    assert.fail(`${label}: expected NotFoundError`);
  } catch (error) {
    assert.ok(error instanceof NotFoundError, `${label}: expected NotFoundError, got ${error}`);
  }
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Convo manage", code: "CM_" + tag } });
  const otherOrg = await prisma.organization.create({ data: { name: "Convo other", code: "CM2_" + tag } });
  const owner = await prisma.user.create({
    data: { organizationId: org.id, email: `cm-${tag}@hermes.test`, name: "CM owner" },
  });
  const stranger = await prisma.user.create({
    data: { organizationId: org.id, email: `cm2-${tag}@hermes.test`, name: "CM stranger" },
  });
  const outsider = await prisma.user.create({
    data: { organizationId: otherOrg.id, email: `cm3-${tag}@hermes.test`, name: "CM outsider" },
  });
  const ownerSession = { organizationId: org.id, userId: owner.id, userEmail: owner.email, userName: owner.name };
  const strangerSession = { organizationId: org.id, userId: stranger.id, userEmail: stranger.email, userName: stranger.name };
  const outsiderSession = { organizationId: otherOrg.id, userId: outsider.id, userEmail: outsider.email, userName: outsider.name };

  try {
    console.log("▶ CM1 归档 → 默认列表消失 → 恢复 → 重新可见");
    const convo = await createKernConversation(ownerSession, { title: "上市推进" });
    let listed = await listKernConversations(ownerSession);
    assert.ok(listed.some((c) => c.id === convo.id), "新建会话应出现在默认列表");

    await archiveKernConversation(ownerSession, convo.id, true);
    listed = await listKernConversations(ownerSession);
    assert.ok(!listed.some((c) => c.id === convo.id), "归档后不应出现在默认列表");
    const archivedRow = await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } });
    assert.ok(archivedRow.archivedAt instanceof Date, "归档时间已写入");
    assert.equal(await prisma.message.count({ where: { conversationId: convo.id } }), 0, "归档不清理消息（可逆）");

    await archiveKernConversation(ownerSession, convo.id, false);
    listed = await listKernConversations(ownerSession);
    assert.ok(listed.some((c) => c.id === convo.id), "恢复后重新可见");

    console.log("▶ CM2 重命名：正常 / 空串回落默认 / 空白串回落默认");
    const renamed = await renameKernConversation(ownerSession, convo.id, "低糖燕麦脆上市");
    assert.equal(renamed.title, "低糖燕麦脆上市");
    const fallback = await renameKernConversation(ownerSession, convo.id, "");
    assert.equal(fallback.title, "新对话", "空串回落默认名");
    const fallback2 = await renameKernConversation(ownerSession, convo.id, "   ");
    assert.equal(fallback2.title, "新对话", "空白串回落默认名");

    console.log("▶ CM3 跨组织访问 → NotFound（不泄漏存在性）");
    await expectNotFound(
      renameKernConversation(outsiderSession, convo.id, "偷改"),
      "跨组织 rename"
    );
    await expectNotFound(
      archiveKernConversation(outsiderSession, convo.id, true),
      "跨组织 archive"
    );

    console.log("▶ CM4 同组织他人会话 → NotFound（owner 校验，同名不可绕过）");
    const sameTitle = await createKernConversation(strangerSession, { title: "低糖燕麦脆上市" });
    await expectNotFound(
      renameKernConversation(ownerSession, sameTitle.id, "抢占"),
      "同组织他人 rename"
    );
    await expectNotFound(
      archiveKernConversation(ownerSession, sameTitle.id, true),
      "同组织他人 archive"
    );

    console.log("▶ CM5 归档会话仍可重命名（归档 ≠ 锁死），且不因归档二次归档报错");
    await archiveKernConversation(ownerSession, convo.id, true);
    const renamedArchived = await renameKernConversation(ownerSession, convo.id, "归档中改名");
    assert.equal(renamedArchived.title, "归档中改名");
    const archivedAgain = await archiveKernConversation(ownerSession, convo.id, true);
    assert.ok(archivedAgain.archivedAt instanceof Date, "重复归档幂等");

    console.log("✅ 会话管理回归全绿");
  } finally {
    await prisma.organization.deleteMany({ where: { code: { in: ["CM_" + tag, "CM2_" + tag] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
