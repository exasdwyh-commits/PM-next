import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { UnprocessableEntityError } from "../src/shared/errors";
import { createProduct } from "../src/modules/products/service";
import { getLaunchContext, prepareLaunch, requestFormalG3Approval, confirmLaunchExecution } from "../src/modules/launch/service";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Launch owner candidates", code: `LAUNCH_OWNER_${tag}` } });
  const admin = await prisma.user.create({ data: { organizationId: org.id, name: "真实管理员", email: `launch-owner-${tag}@hermes.test` } });
  const member = await prisma.user.create({ data: { organizationId: org.id, name: "普通成员", email: `launch-member-${tag}@hermes.test` } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN } });
  const session = { organizationId: org.id, userId: admin.id, userEmail: admin.email, userName: "不应作为候选名称使用" };
  const memberSession = { organizationId: org.id, userId: member.id, userEmail: member.email, userName: member.name };
  try {
    const product = await createProduct(session, { name: "历史产品", identityCode: `LEGACY_${tag}`, targetAudience: "人群", marketPath: "渠道", devMode: "NEW_PRODUCT" });
    const restricted = await getLaunchContext(memberSession, product.id);
    assert.equal(restricted.canEdit, false);
    assert.deepEqual(restricted.ownerCandidates, []);
    console.log("PASS ordinary member cannot gain projectless product write access");

    const context = await getLaunchContext(session, product.id);
    assert.equal(context.canEdit, true);
    assert.deepEqual(context.ownerCandidates, [{ id: admin.id, name: admin.name, email: admin.email, role: "ORG_ADMIN" }]);
    console.log("PASS active authenticated administrator is a real owner candidate");

    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    const inactive = await getLaunchContext(session, product.id);
    assert.deepEqual(inactive.ownerCandidates, []);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: true } });
    console.log("PASS inactive users do not appear as owner candidates");

    const result = await prepareLaunch(session, { productId: product.id, ownerId: context.ownerCandidates[0].id, targetDate: "2027-01-01" });
    const prepared = await getLaunchContext(session, product.id);
    assert.equal(prepared.plan?.id, result.planId);
    assert.equal(prepared.plan?.projectId, null);
    assert.equal(prepared.canRequestG3, false);
    await assert.rejects(() => requestFormalG3Approval(session, result.planId), UnprocessableEntityError);
    await assert.rejects(() => confirmLaunchExecution(session, result.planId, { note: "尚未满足真实生产门禁" }), UnprocessableEntityError);
    console.log("PASS planning succeeds while formal G3 and actual launch remain blocked");
  } finally {
    await prisma.launchPlan.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: admin.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
