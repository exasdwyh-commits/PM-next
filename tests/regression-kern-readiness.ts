import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { ensureWorkspaceSetup } from "../src/modules/workspace/setup";
import { getMissionReadiness } from "../src/modules/supervisor/readiness";
import { buildNewProductMissionPlan } from "../src/modules/supervisor/plan";
import { createBriefForMessage, briefCitation, getBrief, actOnBrief } from "../src/modules/supervisor/brief";
import { competitorSubject, requiredCompetitorQuestions } from "../src/modules/supervisor/competitor-brief";
import { setMissionModelInvokerForTest } from "../src/modules/supervisor/generic-executor";
import { setWebSearchForTest } from "../src/modules/supervisor/web-search";
import { beatWorker, markWorkerStopped } from "../src/modules/worker/heartbeat";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.create({ data: { code: `RDY_${randomUUID().slice(0, 8)}`, name: "Readiness test" } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@kern.test`, name: "Owner", organizationId: org.id,
    orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
  const session = { organizationId: org.id, userId: user.id, userEmail: user.email, userName: user.name };
  const oldLimit = process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH;
  setWebSearchForTest(null);
  try {
    await ensureWorkspaceSetup(session);
    const modelCount = await prisma.modelProfileConfig.count({ where: { organizationId: org.id } });
    const policyCount = await prisma.modelPolicyConfig.count({ where: { organizationId: org.id } });
    const binding = await prisma.agentModelPolicyBinding.findFirstOrThrow({ where: { organizationId: org.id } });
    await prisma.agentModelPolicyBinding.update({ where: { id: binding.id }, data: { policyKey: "custom-policy" } });
    const counts = await prisma.agent.count({ where: { organizationId: org.id } });
    const profile = await prisma.modelProfileConfig.findFirstOrThrow({ where: { organizationId: org.id } });
    const agent = await prisma.agent.findFirstOrThrow({ where: { organizationId: org.id, code: "research_agent" } });
    await prisma.agent.update({ where: { id: agent.id }, data: { name: "Custom", status: "PAUSED", instructions: "Keep me" } });
    await prisma.modelProfileConfig.update({ where: { id: profile.id }, data: { modelId: "custom-model", enabled: false } });
    await ensureWorkspaceSetup(session);
    assert.equal(await prisma.agent.count({ where: { organizationId: org.id } }), counts);
    assert.equal(await prisma.modelProfileConfig.count({ where: { organizationId: org.id } }), modelCount);
    assert.equal(await prisma.modelPolicyConfig.count({ where: { organizationId: org.id } }), policyCount);
    assert.equal((await prisma.agentModelPolicyBinding.findUniqueOrThrow({ where: { id: binding.id } })).policyKey, "custom-policy");
    const kept = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    assert.equal(kept.status, "PAUSED"); assert.equal(kept.instructions, "Keep me"); assert.equal(kept.name, "Custom");
    assert.equal((await prisma.modelProfileConfig.findUniqueOrThrow({ where: { id: profile.id } })).modelId, "custom-model");
    const member = await prisma.user.create({ data: { organizationId: org.id, name: "Member", email: `${randomUUID()}@kern.test` } });
    await assert.rejects(ensureWorkspaceSetup({ ...session, userId: member.id }), /管理员/);
    console.log("R1: initialization is repeatable, preserves custom/disabled values, enforces admin");

    const goal = "帮我做一份竞品调研：比较定位、价格带、渠道和差异化。调研对象是：";
    const plan = buildNewProductMissionPlan(goal + "三只松鼠、良品铺子");
    let r = await getMissionReadiness(session, plan);
    assert.ok(r.blockers.some(b => b.code === "TEAM")); assert.ok(r.blockers.some(b => b.code === "MODEL"));
    assert.ok(r.blockers.some(b => b.code === "SEARCH")); assert.equal(r.demoReady, false);
    await prisma.agent.update({ where: { id: agent.id }, data: { status: "ACTIVE" } });
    setMissionModelInvokerForTest(async () => ({ text: "fixture", provenance: {} }));
    await markWorkerStopped();
    r = await getMissionReadiness(session, plan);
    assert.ok(r.blockers.some(b => b.code === "WORKER")); assert.equal(r.demoReady, false);
    await beatWorker({ loops: ["executor"], startedAt: new Date() }, true);
    r = await getMissionReadiness(session, plan); assert.equal(r.demoReady, true); assert.equal(r.ready, false);
    setWebSearchForTest(async () => []);
    r = await getMissionReadiness(session, plan); assert.equal(r.ready, true);
    process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = "0";
    r = await getMissionReadiness(session, plan); assert.ok(r.blockers.some(b => b.code === "USAGE"));
    if (oldLimit === undefined) delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH; else process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = oldLimit;
    console.log("R2: actual team, model, executor, search and usage conditions gate formal launch; demo is separate");

    assert.equal(requiredCompetitorQuestions(goal).length, 1);
    assert.equal(requiredCompetitorQuestions("竞品调研，调研对象：三只松鼠、良品铺子").length, 0);
    assert.equal(competitorSubject("竞品调研，调研对象：待填写"), null);
    const chat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "Readiness" } });
    const message = await prisma.message.create({ data: { conversationId: chat.id, role: "ASSISTANT", content: "Plan" } });
    const fresh = await createBriefForMessage(session, { messageId: message.id, playbook: "GENERIC", goal, goalPlan: plan });
    assert.equal(fresh.stage, "CLARIFY");
    // Simulate a historical card created before required clarification existed.
    const historical = { ...fresh, stage: "PLAN" as const, questions: [], plan, clarifiedPlan: null };
    await prisma.message.update({ where: { id: message.id }, data: { citations: [briefCitation(message.id, historical)] as unknown as Prisma.InputJsonValue } });
    assert.equal((await getBrief(session, message.id)).brief.stage, "CLARIFY");
    await assert.rejects(actOnBrief(session, message.id, { action: "skip-questions" }), /请先填写/);
    await assert.rejects(actOnBrief(session, message.id, { action: "answer", answers: { "competitor-subject": { text: "未知" } } }), /请先填写/);
    const answered = await actOnBrief(session, message.id, { action: "answer", answers: { "competitor-subject": { text: "三只松鼠、良品铺子" } } });
    assert.equal(answered.brief.stage, "PLAN");
    assert.equal(answered.brief.plan?.nodes.length, plan.nodes.length);
    assert.equal(competitorSubject(answered.brief.plan!.goal), "三只松鼠、良品铺子");
    const scoped = await actOnBrief(session, message.id, { action: "set-research-scope", text: "中国大陆；线上电商；近 30 天；定位、价格、渠道、差异化" });
    assert.match(scoped.brief.plan!.goal, /中国大陆/);
    assert.ok(scoped.brief.contract?.constraints.some(c => c.includes("近 30 天")));
    assert.equal(scoped.brief.plan!.nodes.length, plan.nodes.length);
    await markWorkerStopped();
    await assert.rejects(actOnBrief(session, message.id, { action: "launch" }), /后台执行器/);
    await assert.rejects(actOnBrief(session, message.id, { action: "launch", demo: true }), /后台执行器/);
    assert.equal(await prisma.agentTask.count({ where: { organizationId: org.id } }), 0);
    console.log("R3: historical cards upgrade without losing plan; mandatory target cannot be skipped; launch rechecks before creating tasks");
  } finally {
    setMissionModelInvokerForTest(null); setWebSearchForTest(undefined);
    if (oldLimit === undefined) delete process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH; else process.env.KERN_LIMIT_MODEL_CALLS_PER_MONTH = oldLimit;
    await markWorkerStopped();
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: (await prisma.user.findMany({ where: { organizationId: org.id }, select: { id: true } })).map(u => u.id) } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
