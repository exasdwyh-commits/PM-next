import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { sendDepartmentAssistantMessage } from "../src/modules/assistant-runtime/service";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/worker/loops";
import {
  buildNewProductMissionPlan,
  getKernMissionStatus,
  launchKernMission,
  setMissionModelInvokerForTest,
} from "../src/modules/supervisor";

/**
 * Kern Supervisor end-to-end (real DB, real worker loops, stubbed model):
 *   goal → mission root → DAG children → QA REVISE → re-delegation →
 *   synthesis → report returned to the originating conversation.
 */

async function drain(organizationId: string, rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0) {
      const queued = await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } });
      if (queued === 0) return;
    }
  }
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Supervisor Test", code: "SUP_" + tag } });
  const admin = await prisma.user.create({
    data: { organizationId: org.id, email: `sup-${tag}@hermes.test`, name: "Owner" },
  });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: admin.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: admin.id, organizationId: org.id, userEmail: admin.email, userName: admin.name };
  await bootstrapDefaultWorkforce(session);

  const conversation = await prisma.conversation.create({
    data: { organizationId: org.id, ownerId: admin.id, title: "新产品" },
  });

  const seen: string[] = [];
  let qaCalls = 0;
  setMissionModelInvokerForTest(async ({ agentCode, messages }) => {
    const user = messages[messages.length - 1].content;
    const key = /## 你的任务（([^）]+)）/.exec(user)?.[1] ?? "?";
    seen.push(key);
    if (key === "qa") {
      qaCalls++;
      return {
        text: qaCalls === 1
          ? JSON.stringify({ verdict: "REVISE", summary: "机会判断证据不足", issues: [{ target: "opportunity", problem: "差异化没有竞品对照" }] })
          : JSON.stringify({ verdict: "PASS", summary: "可以交付", issues: [] }),
        provenance: { stub: true },
      };
    }
    if (key === "opportunity" && qaCalls === 1) {
      assert.match(user, /QA 要求你修正[\s\S]*差异化没有竞品对照/, "revision feedback must reach the specialist");
    }
    if (key === "synthesis") {
      assert.match(user, /QA PASS/, "synthesis must see the final QA result");
      return { text: "结论：推荐方向 A。需要你决定的事：目前不需要你决定。", provenance: { stub: true } };
    }
    return { text: `${agentCode} 对 ${key} 的结构化结论（推断）。`, provenance: { stub: true } };
  });

  try {
    console.log("▶ S1 mission launch is idempotent and dispatches the parallel first pass");
    const plan = buildNewProductMissionPlan("我想开发一个新的产品");
    const sourceRunId = "run-" + tag;
    const launched = await launchKernMission(session, { plan, conversationId: conversation.id, sourceRunId });
    const replay = await launchKernMission(session, { plan, conversationId: conversation.id, sourceRunId });
    assert.equal(replay.missionTaskId, launched.missionTaskId);
    assert.equal(replay.created, false);
    let status = await getKernMissionStatus(session, launched.missionTaskId);
    assert.deepEqual(
      status.nodes.filter((n) => n.status === "ACTIVE").map((n) => n.key).sort(),
      ["compliance", "economics", "market"]
    );
    console.log("  ✔ first pass dispatched as real child AgentTasks");

    console.log("▶ S2 worker drives the DAG, QA revision and synthesis to completion");
    await drain(org.id);
    status = await getKernMissionStatus(session, launched.missionTaskId);
    assert.equal(status.status, AgentTaskStatus.SUCCEEDED, JSON.stringify(status.log.slice(-6)));
    assert.equal(status.outcome?.status, "COMPLETED");
    assert.equal(status.revisionRounds, 1);
    assert.equal(qaCalls, 2);
    assert.ok(seen.indexOf("opportunity") > seen.indexOf("market"), "dependency order respected");
    assert.equal(seen.filter((k) => k === "opportunity").length, 2, "opportunity re-delegated once");
    assert.equal(seen.filter((k) => k === "market").length, 1, "unaffected nodes are not re-run");
    assert.equal(seen.at(-1), "synthesis");
    const delegations = await prisma.agentDelegation.count({ where: { parentTaskId: launched.missionTaskId } });
    assert.equal(delegations, status.tasksCreated - 1, "every non-Kern node has delegation lineage");
    console.log(`  ✔ ${status.tasksCreated} child tasks, 1 QA revision round, synthesis last`);

    console.log("▶ S3 result returns once to the originating conversation");
    await reconcileLoopOnce({ organizationId: org.id });
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id } });
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /推荐方向 A/);
    console.log("  ✔ single mission report message");

    console.log("▶ S4 no runnable model → honest BLOCKED, mission escalates to user");
    setMissionModelInvokerForTest(async () => ({ unavailable: "no policy" }));
    const blocked = await launchKernMission(session, {
      plan: buildNewProductMissionPlan("再做一个新产品"),
      conversationId: conversation.id,
      sourceRunId: "run2-" + tag,
    });
    await drain(org.id);
    const bs = await getKernMissionStatus(session, blocked.missionTaskId);
    assert.equal(bs.status, AgentTaskStatus.WAITING_HUMAN);
    assert.equal(bs.outcome?.status, "NEEDS_USER");
    const last = await prisma.message.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" } });
    assert.match(last!.content, /模型服务暂时不可用/);
    assert.ok(bs.outcome?.reasons.includes("MODEL_UNAVAILABLE"));
    assert.doesNotMatch(last!.content, /tried|policy/, "no raw internals shown to the user");
    assert.doesNotMatch(last!.content, /推荐方向/);
    console.log("  ✔ no fabricated result; user is asked to intervene");

    console.log("▶ S5 saying 'I want to build a new product' in Kern chat launches a mission");
    const chat = await prisma.conversation.create({
      data: { organizationId: org.id, ownerId: admin.id, title: "Kern" },
    });
    const turn = await sendDepartmentAssistantMessage(session, chat.id, "我想开发一个新的产品");
    assert.ok(turn.mission?.missionTaskId, "mission launched from chat: " + turn.missionError);
    assert.equal(turn.routingReceipt.phase, "MISSION");
    assert.match(turn.message.content, /我已接手这项工作/);
    const chatMission = await getKernMissionStatus(session, turn.mission!.missionTaskId);
    assert.equal(chatMission.playbook, "NEW_PRODUCT");
    const casual = await sendDepartmentAssistantMessage(session, chat.id, "今天有什么任务");
    assert.equal(casual.mission, null, "ordinary questions stay single-turn");
    console.log("  ✔ chat entry → mission; ordinary question → no mission");

    console.log("▶ S6 '继续' after fixing the model resumes the stopped mission in place");
    setMissionModelInvokerForTest(async ({ messages }) => {
      const user = messages[messages.length - 1].content;
      const key = /## 你的任务（([^）]+)）/.exec(user)?.[1] ?? "?";
      if (key === "qa") return { text: JSON.stringify({ verdict: "PASS", summary: "ok", issues: [] }), provenance: { stub: true } };
      if (key === "synthesis") return { text: "恢复后结论：推荐方向 B", provenance: { stub: true } };
      return { text: `${key} 已完成`, provenance: { stub: true } };
    });
    const again = await sendDepartmentAssistantMessage(session, conversation.id, "继续");
    assert.equal(again.mission?.missionTaskId, blocked.missionTaskId, "resumes the same mission, not a new one");
    assert.match(again.message.content, /接着推进/);
    await drain(org.id);
    const rs = await getKernMissionStatus(session, blocked.missionTaskId);
    assert.equal(rs.outcome?.status, "COMPLETED");
    const report = await prisma.message.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" } });
    assert.match(report!.content, /推荐方向 B/);
    const noop = await sendDepartmentAssistantMessage(session, conversation.id, "继续");
    assert.equal(noop.mission, null, "completed missions are not resumed");
    console.log("  ✔ resumed in place and completed");

    console.log("▶ S7 memory: outcomes are learned, '记住' is stored and injected into later work");
    const outcome = await prisma.kernMemory.findFirst({ where: { userId: admin.id, kind: "OUTCOME", source: `mission:${blocked.missionTaskId}` } });
    assert.ok(outcome && /推荐方向 B/.test(outcome.content), "completed mission became recall memory");
    const rem = await sendDepartmentAssistantMessage(session, chat.id, "记住：我们只做跨境电商");
    assert.ok(rem.memorySaved, "explicit memory saved");
    assert.equal(rem.mission, null);
    assert.match(rem.message.content, /记住了/);
    const prompts: string[] = [];
    setMissionModelInvokerForTest(async ({ messages }) => {
      prompts.push(messages.map((m) => m.content).join("\n"));
      return { text: JSON.stringify({ verdict: "PASS", summary: "ok", issues: [] }), provenance: { stub: true } };
    });
    await launchKernMission(session, { plan: buildNewProductMissionPlan("第三个产品"), conversationId: chat.id, sourceRunId: "run3-" + tag });
    await drain(org.id);
    assert.ok(prompts.length > 0 && prompts.every((p) => p.includes("只做跨境电商")), "preference injected into every node");
    console.log("  ✔ memory written, stored and injected");

    console.log("\n✅ Kern supervisor regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
