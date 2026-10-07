/**
 * KX-36 做法 — 真实数据库回归。
 *  PB1 保存校验：未完成 / 演示 → 422；他人的工作 404；重复保存幂等
 *  PB2 匹配：相似目标命中本人做法；无关目标、他人不命中
 *  PB3 按做法启动 → useCount / successCount 计数
 *  PB4 重命名 / 删除：他人 404
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/supervisor/worker-runtime";
import { buildNewProductMissionPlan, launchKernMission, readMissionSnapshot, setMissionModelInvokerForTest } from "../src/modules/supervisor";
import { deletePlaybook, findPlaybookForGoal, listPlaybooks, markPlaybookUsed, renamePlaybook, savePlaybookFromMission } from "../src/modules/playbooks/service";
import { instantiatePlan } from "../src/modules/playbooks/match";

async function drain(organizationId: string, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0 && (await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } })) === 0) return;
  }
}
const stub = (text: string) => ({ text, provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } });
const snapOf = async (id: string) => readMissionSnapshot((await prisma.agentTask.findUnique({ where: { id } }))?.contextSnapshot);
const code = (n: number) => (e: { statusCode?: number }) => e.statusCode === n;

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);
  setMissionModelInvokerForTest(async ({ messages }) => {
    const all = messages.map((m) => m.content).join("\n");
    const key = /## 你的任务（([^）]+)）/.exec(all)?.[1] ?? "?";
    if (key === "qa") return stub(JSON.stringify({ verdict: "PASS", summary: "可以交付", issues: [] }));
    if (key === "compliance") return stub("结论。\n合规判定：可做");
    return stub(`${key} 的结论。`);
  });
  const org = await prisma.organization.create({ data: { name: "Playbook", code: `PB_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `pb-${tag}@hermes.test`, name: "Owner" } });
  const other = await prisma.user.create({ data: { organizationId: org.id, email: `pb2-${tag}@hermes.test`, name: "Other" } });
  await prisma.organizationMember.createMany({ data: [{ organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN }, { organizationId: org.id, userId: other.id, role: OrgRole.ORG_ADMIN }] });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  const otherSession = { userId: other.id, organizationId: org.id, userEmail: other.email, userName: other.name };
  await bootstrapDefaultWorkforce(session);
  try {
    console.log("▶ PB1 保存校验");
    const goal = "我想开发一个宠物智能喂食器";
    const m1 = await launchKernMission(session, { conversationId: null, sourceRunId: null, plan: buildNewProductMissionPlan(goal) });
    await assert.rejects(savePlaybookFromMission(session, m1.missionTaskId), code(422));
    await drain(org.id);
    const snap = await snapOf(m1.missionTaskId);
    assert.equal(snap?.outcome?.status, "COMPLETED", `任务应完成：${JSON.stringify(snap?.outcome)}`);
    await assert.rejects(savePlaybookFromMission(otherSession, m1.missionTaskId), code(404));
    const s1 = await savePlaybookFromMission(session, m1.missionTaskId, "硬件新品做法");
    assert.equal(s1.created, true);
    const s2 = await savePlaybookFromMission(session, m1.missionTaskId);
    assert.equal(s2.created, false);
    assert.equal((await listPlaybooks(session)).length, 1);
    const demo = await launchKernMission(session, { conversationId: null, sourceRunId: null, plan: buildNewProductMissionPlan(goal), demo: true });
    await drain(org.id);
    await assert.rejects(savePlaybookFromMission(session, demo.missionTaskId), code(422));

    console.log("▶ PB2 匹配");
    const hit = await findPlaybookForGoal(session, "我想开发一个宠物智能饮水机");
    assert.equal(hit?.id, s1.item.id);
    assert.equal(await findPlaybookForGoal(session, "帮我整理本周会议纪要"), null);
    assert.equal(await findPlaybookForGoal(otherSession, "我想开发一个宠物智能饮水机"), null);

    console.log("▶ PB3 按做法启动 → 计数");
    const m2 = await launchKernMission(session, { conversationId: null, sourceRunId: null, plan: instantiatePlan(hit!.template, "我想开发一个宠物智能饮水机"), playbookRef: { id: hit!.id, name: hit!.name } });
    await markPlaybookUsed(hit!.id);
    await drain(org.id);
    const row = await prisma.kernPlaybook.findUniqueOrThrow({ where: { id: hit!.id } });
    assert.equal(row.useCount, 1);
    assert.equal(row.successCount, 1, "按做法完成的工作应计一次成功");
    assert.equal((await snapOf(m2.missionTaskId))?.playbookRef?.id, hit!.id);

    console.log("▶ PB4 重命名 / 删除越权");
    await assert.rejects(renamePlaybook(otherSession, hit!.id, "x"), code(404));
    await assert.rejects(deletePlaybook(otherSession, hit!.id), code(404));
    assert.equal((await renamePlaybook(session, hit!.id, "新名字")).name, "新名字");
    await deletePlaybook(session, hit!.id);
    assert.equal((await listPlaybooks(session)).length, 0);
    console.log("✅ KX-36 做法回归全部通过");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.kernPlaybook.deleteMany({ where: { organizationId: org.id } });
    await prisma.kernMissionEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.id, other.id] } } });
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
