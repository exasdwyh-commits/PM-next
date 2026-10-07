import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { beatWorker, markWorkerStopped } from "../src/modules/worker/heartbeat";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/supervisor/worker-runtime";
import { setMissionModelInvokerForTest } from "../src/modules/supervisor/generic-executor";
import { buildNewProductMissionPlan, type MissionPlan } from "../src/modules/supervisor/plan";
import { advanceKernMission, getKernMissionStatus, launchKernMission, listActiveMissionIds,
  readMissionSnapshot, toJson } from "../src/modules/supervisor/service";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { code: `DELIVERY_${tag}`, name: "Execution delivery regression" } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `${tag}@kern.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { organizationId: org.id, userId: owner.id, userEmail: owner.email, userName: owner.name };
  let mode: "answer" | "tool-limit" | "empty-synthesis" | "markup-synthesis" = "answer";
  let modelCalls = 0;
  const base = buildNewProductMissionPlan("完成计算并交付答案");
  const plan: MissionPlan = { ...base, playbook: "GENERIC", nodes: [
    { ...base.nodes[0], objective: "计算 1+1，给出答案", taskClass: "ASSISTANT_DIALOGUE" },
    { ...base.nodes.at(-1)!, dependsOn: ["market"] },
  ] };

  try {
    await bootstrapDefaultWorkforce(session);
    await beatWorker({ organizationId: org.id, loops: ["executor"], startedAt: new Date() }, true);
    setMissionModelInvokerForTest(async ({ agentCode }) => {
      modelCalls++;
      if (mode === "tool-limit" && agentCode === "research_agent") {
        return { text: '<tool_call>{"name":"calculate","arguments":{"expression":"1+1"}}</tool_call>', provenance: { stub: true } };
      }
      const text = agentCode === "hermes_pm" && mode === "empty-synthesis" ? " "
        : agentCode === "hermes_pm" && mode === "markup-synthesis" ? "<p></p>" : "结论：1+1 = 2。";
      return { text, provenance: { stub: true } };
    });
    const run = async () => {
      const chat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: mode } });
      const mission = await launchKernMission(session, { plan, conversationId: chat.id, sourceRunId: randomUUID() });
      for (let i = 0; i < 8; i++) {
        await executorLoopOnce({ organizationId: org.id, limit: 4 });
        await reconcileLoopOnce({ organizationId: org.id });
        if ((await getKernMissionStatus(session, mission.missionTaskId)).outcome) break;
      }
      return { chat, mission, status: await getKernMissionStatus(session, mission.missionTaskId) };
    };

    mode = "tool-limit";
    const exhausted = await run();
    assert.equal(exhausted.status.outcome?.status, "NEEDS_USER");
    const market = exhausted.status.nodes.find(n => n.key === "market")!;
    assert.equal(market.status, "BLOCKED");
    assert.equal(market.reason, "OUTPUT_INCOMPLETE:TOOL_LIMIT");
    const exhaustedReceipt = await prisma.message.findFirstOrThrow({ where: { conversationId: exhausted.chat.id } });
    assert.match(exhaustedReceipt.content, /尚未形成可交付结果/);
    assert.doesNotMatch(exhaustedReceipt.content, /<tool_call>/);
    assert.equal(modelCalls, 6, "four tools, one final-answer attempt, one synthesis; no unbounded retry");
    console.log("D1: unfinished tool loop is BLOCKED with a useful receipt; real worker never marks it complete");

    for (const emptyMode of ["empty-synthesis", "markup-synthesis"] as const) {
      mode = emptyMode;
      const empty = await run();
      assert.equal(empty.status.outcome?.status, "NEEDS_USER");
      assert.equal(empty.status.nodes.find(n => n.key === "synthesis")?.reason, "OUTPUT_INCOMPLETE:EMPTY_OUTPUT");
      assert.match((await prisma.message.findFirstOrThrow({ where: { conversationId: empty.chat.id } })).content, /没有返回可交付内容/);
    }
    console.log("D2: blank/empty rendered synthesis is BLOCKED and its failure reason reaches the original conversation");

    mode = "answer";
    const completed = await run();
    assert.equal(completed.status.outcome?.status, "COMPLETED");
    const root = await prisma.agentTask.findUniqueOrThrow({ where: { id: completed.mission.missionTaskId } });
    const snapshot = readMissionSnapshot(root.contextSnapshot)!;
    const beforeRecovery = modelCalls;
    for (const outcome of ["COMPLETED", "NEEDS_USER", "CANCELLED"] as const) {
      const chat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: `Recover ${outcome}` } });
      // Durable crash window: outcome committed, conversation receipt not yet written.
      const task = await prisma.agentTask.create({ data: {
        organizationId: org.id, agentId: root.agentId, goal: plan.goal, createdByUserId: owner.id,
        status: outcome === "COMPLETED" ? AgentTaskStatus.SUCCEEDED : outcome === "CANCELLED" ? AgentTaskStatus.CANCELLED : AgentTaskStatus.WAITING_HUMAN,
        contextSnapshot: toJson({ ...snapshot, conversationId: chat.id,
          outcome: { ...snapshot.outcome, status: outcome, messageId: null } }),
      } });
      assert.ok((await listActiveMissionIds(org.id)).some(t => t.id === task.id));
      assert.ok(!(await listActiveMissionIds(randomUUID())).some(t => t.id === task.id));
      await assert.rejects(advanceKernMission({ ...session, organizationId: randomUUID() }, task.id), /Mission not found/);
      await Promise.all([
        reconcileLoopOnce({ organizationId: org.id }),
        advanceKernMission(session, task.id),
        advanceKernMission(session, task.id),
      ]);
      const receipts = await prisma.message.findMany({ where: { conversationId: chat.id } });
      assert.equal(receipts.length, 1, "concurrent retry delivers exactly once");
      if (outcome === "CANCELLED") assert.match(receipts[0].content, /按你的要求取消/);
      const delivered = readMissionSnapshot((await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } })).contextSnapshot)!;
      assert.equal(delivered.outcome?.messageId, receipts[0].id);
      assert.ok(!(await listActiveMissionIds(org.id)).some(t => t.id === task.id));
      await advanceKernMission(session, task.id);
      assert.equal(await prisma.message.count({ where: { conversationId: chat.id } }), 1);
    }
    assert.equal(modelCalls, beforeRecovery, "delivery recovery never reruns models or tools");
    console.log("D3: worker recovers completed/blocked/cancelled receipts once, with organization isolation and no extra model calls");

    const detached = await prisma.agentTask.create({ data: {
      organizationId: org.id, agentId: root.agentId, goal: plan.goal, status: AgentTaskStatus.SUCCEEDED,
      contextSnapshot: toJson({ ...snapshot, conversationId: null, outcome: { ...snapshot.outcome, messageId: null } }),
    } });
    assert.ok(!(await listActiveMissionIds(org.id)).some(t => t.id === detached.id));
    console.log("D4: tasks without an originating conversation do not enter delivery recovery");

    const broken = await prisma.agentTask.create({ data: {
      organizationId: org.id, agentId: root.agentId, goal: plan.goal, status: AgentTaskStatus.SUCCEEDED,
      contextSnapshot: toJson({ ...snapshot, conversationId: randomUUID(), outcome: { ...snapshot.outcome, messageId: null } }),
    } });
    await advanceKernMission(session, broken.id);
    const backedOff = await prisma.agentTask.findUniqueOrThrow({ where: { id: broken.id } });
    assert.ok(backedOff.availableAt.getTime() > Date.now());
    assert.ok(!(await listActiveMissionIds(org.id)).some(t => t.id === broken.id));
    const repairedChat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: "Repaired destination" } });
    await prisma.agentTask.update({ where: { id: broken.id }, data: { availableAt: new Date(),
      contextSnapshot: toJson({ ...snapshot, conversationId: repairedChat.id, outcome: { ...snapshot.outcome, messageId: null } }),
    } });
    await reconcileLoopOnce({ organizationId: org.id });
    assert.equal(await prisma.message.count({ where: { conversationId: repairedChat.id } }), 1);
    assert.equal(modelCalls, beforeRecovery);
    console.log("D5: failed delivery backs off; repairing its destination recovers the receipt without re-execution");
  } finally {
    setMissionModelInvokerForTest(null);
    await markWorkerStopped();
    try {
      const actors = await prisma.user.findMany({ where: { organizationId: org.id }, select: { id: true } });
      await prisma.auditEvent.deleteMany({ where: { actorId: { in: actors.map(user => user.id) } } });
      await prisma.organization.delete({ where: { id: org.id } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
