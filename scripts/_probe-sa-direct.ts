/**
 * 一次性探针：直接调用 submitWork（不走 HTTP），打印结构化成果写入失败的完整错误栈。
 * 只在测试库运行；夹具自建自删。
 */
import crypto from "crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "../tests/test-safety";
import { submitWork } from "../src/modules/work/service";
import { hashPassword } from "../src/modules/identity/session";

const RUN_TAG = `sadirect${Date.now()}`;

async function main() {
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.create({ data: { code: `${RUN_TAG}_ORG`, name: "直调探针机构" } });
  const owner = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@hermes.test`, name: "负责人", organizationId: org.id, passwordHash: hashPassword("x") },
  });
  const project = await prisma.project.create({
    data: { organizationId: org.id, title: `${RUN_TAG} 项目`, target: "t", ownerId: owner.id, members: { create: [{ userId: owner.id, role: "OWNER" }] } },
  });
  const wi = await prisma.workItem.create({
    data: { projectId: project.id, title: "wi", target: "t", deliverableReq: "d", inputRevision: 1, status: "TODO" },
  });

  const session = { userId: owner.id, organizationId: org.id } as any;
  const validCost = { engineVersion: "v1", scenarioName: "基础情景", currency: "CNY", unit: "盒", expenseBase: "出厂口径", result: 12.5 };
  try {
    const result = await submitWork(session, wi.id, {
      inputRevision: 1,
      runMode: "MANUAL" as any,
      artifacts: [{ type: "COST_SCENARIO", title: "成本情景", content: JSON.stringify(validCost) }],
    });
    console.log("\n▶ 直调成功：", JSON.stringify(result).slice(0, 300));
  } catch (e: any) {
    console.log("\n▶ 直调失败：");
    console.log("  name:", e?.name);
    console.log("  message:", e?.message);
    console.log("  fieldErrors:", JSON.stringify(e?.fieldErrors));
    console.log("  stack:\n", e?.stack?.split("\n").slice(0, 14).join("\n"));
  }

  await prisma.artifact.deleteMany({ where: { workItemId: wi.id } });
  await prisma.workItem.deleteMany({ where: { id: wi.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
}

main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
