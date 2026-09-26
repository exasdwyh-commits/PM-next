import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/worker/loops";
import {
  buildNewProductMissionPlan,
  controlKernMission,
  getKernMissionStatus,
  launchKernMission,
  listMissionEvents,
  setMissionModelInvokerForTest,
} from "../src/modules/supervisor";

/**
 * Display Layer PR ① — mission event log + user interventions
 * (real DB, real worker loops, stubbed model):
 *   ordered events · pause holds dispatch · add-input reaches later steps ·
 *   edit-plan adds a step · rerun reopens a finished mission · skip · cancel ·
 *   owner-only access.
 */

async function drain(organizationId: string, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0) {
      const queued = await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } });
      if (queued === 0) return;
    }
  }
}

async function makeOrg(tag: string, label: string) {
  const org = await prisma.organization.create({ data: { name: `Controls ${label}`, code: `CTL_${label}_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `ctl-${label}-${tag}@hermes.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  await bootstrapDefaultWorkforce(session);
  return { org, session };
}

async function expectReject(p: Promise<unknown>, pattern: RegExp, msg: string) {
  await assert.rejects(p, (e: unknown) => pattern.test(`${(e as Error)?.constructor?.name} ${(e as Error)?.message}`), msg);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);

  const prompts: Record<string, string[]> = {};
  setMissionModelInvokerForTest(async ({ agentCode, messages }) => {
    const user = messages[messages.length - 1].content;
    const key = /## 你的任务（([^）]+)）/.exec(user)?.[1] ?? "?";
    (prompts[key] ??= []).push(user);
    if (key === "qa") return { text: JSON.stringify({ verdict: "PASS", summary: "可以交付", issues: [] }), provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } };
    if (key === "synthesis") return { text: "结论：推荐方向 A。", provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } };
    return { text: `${agentCode} 对 ${key} 的结论。`, provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } };
  });

  try {
    // ------------------------------------------------------------------
    const a = await makeOrg(tag, "A");
    const conv = await prisma.conversation.create({ data: { organizationId: a.org.id, ownerId: a.session.userId, title: "新产品" } });
    const { missionTaskId: m1 } = await launchKernMission(a.session, {
      plan: buildNewProductMissionPlan("我想开发一个新产品"),
      conversationId: conv.id,
      sourceRunId: "ctl-a-" + tag,
    });

    console.log("▶ C1 pause holds new dispatch; active steps still finish");
    const paused = await controlKernMission(a.session, m1, { action: "pause" });
    assert.deepEqual((paused.activeNodeKeys as string[]).sort(), ["compliance", "economics", "market"]);
    await expectReject(controlKernMission(a.session, m1, { action: "pause" }), /Conflict/, "double pause is a conflict");
    await drain(a.org.id);
    let st = await getKernMissionStatus(a.session, m1);
    assert.ok(st.paused, "still paused");
    assert.equal(st.nodes.find((n) => n.key === "market")!.status, "SUCCEEDED");
    assert.equal(st.nodes.find((n) => n.key === "opportunity")!.status, "PENDING", "no dispatch while paused");
    assert.equal(st.outcome, null);
    console.log("  ✔ first pass finished, opportunity held");

    console.log("▶ C2 add-input + edit-plan while paused");
    const input = await controlKernMission(a.session, m1, { action: "add-input", text: "预算上限 50 万，只做线上渠道" });
    assert.ok((input.willApplyTo as string[]).includes("opportunity"));
    const edited = await controlKernMission(a.session, m1, {
      action: "edit-plan",
      edits: [
        { op: "add", node: { key: "pricing", agentCode: "cost_bom_agent", objective: "给出三档定价方案与对应毛利。", dependsOn: ["market"] } },
        { op: "objective", key: "gtm", objective: "只考虑线上渠道的上市策略。" },
      ],
    });
    assert.equal((edited.changes as string[]).length, 2);
    await expectReject(
      controlKernMission(a.session, m1, { action: "edit-plan", edits: [{ op: "remove", key: "market" }] }),
      /Unprocessable.*NODE_NOT_PENDING/,
      "finished steps cannot be edited"
    );
    await expectReject(
      controlKernMission(a.session, m1, { action: "edit-plan", edits: [{ op: "remove", key: "qa" }] }),
      /Unprocessable.*STRUCTURAL/,
      "QA is structural"
    );
    console.log("  ✔ input queued, pricing step added, guards hold");

    console.log("▶ C3 resume → mission completes with input carried into later steps");
    await controlKernMission(a.session, m1, { action: "resume" });
    await drain(a.org.id);
    st = await getKernMissionStatus(a.session, m1);
    assert.equal(st.outcome?.status, "COMPLETED", JSON.stringify(st.outcome));
    assert.equal(st.nodes.find((n) => n.key === "pricing")!.status, "SUCCEEDED");
    assert.match(prompts.opportunity.at(-1)!, /用户在执行中补充的信息[\s\S]*预算上限 50 万/);
    assert.match(prompts.synthesis.at(-1)!, /pricing/, "synthesis sees the added step");
    assert.ok(!prompts.market.some((p) => /预算上限/.test(p)), "earlier steps are not rewritten");
    assert.ok(st.userInputs[0].appliedTo.includes("opportunity"));
    assert.ok(!st.userInputs[0].appliedTo.includes("market"));
    console.log("  ✔ completed; input applied only to later steps");

    console.log("▶ C4 event log is ordered, contiguous and complete");
    const events = await listMissionEvents(a.session, m1);
    assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1), "seq is 1..N without gaps");
    const types = new Set(events.map((e) => e.type));
    for (const t of ["mission.launched", "mission.paused", "user.input", "plan.edited", "mission.resumed", "node.dispatched", "node.started", "node.tool", "node.delta", "node.finished", "user.input.applied", "mission.finished"]) {
      assert.ok(types.has(t as never), `missing ${t}`);
    }
    const pausedSeq = events.find((e) => e.type === "mission.paused")!.seq;
    const resumedSeq = events.find((e) => e.type === "mission.resumed")!.seq;
    assert.ok(!events.some((e) => e.type === "node.dispatched" && e.seq > pausedSeq && e.seq < resumedSeq), "no dispatch between pause and resume");
    const fin = events.find((e) => e.type === "node.finished" && e.nodeKey === "market")!;
    assert.equal(fin.payload.model, "stub-1");
    assert.equal(fin.payload.status, "SUCCEEDED");
    const tool = events.find((e) => e.type === "node.tool" && e.nodeKey === "market")!;
    assert.equal(typeof tool.payload.latencyMs, "number");
    const after = await listMissionEvents(a.session, m1, events.length - 2);
    assert.deepEqual(after.map((e) => e.seq), [events.length - 1, events.length]);
    console.log(`  ✔ ${events.length} events, cursor paging works`);

    console.log("▶ C5 rerun a finished step reopens the mission and reruns downstream only");
    const beforeMarket = prompts.market.length;
    const rerun = await controlKernMission(a.session, m1, { action: "rerun", nodeKey: "gtm", feedback: "补充小红书渠道" });
    assert.equal(rerun.reopened, true);
    assert.deepEqual((rerun.resetKeys as string[]).sort(), ["gtm", "qa", "synthesis"]);
    await drain(a.org.id);
    st = await getKernMissionStatus(a.session, m1);
    assert.equal(st.outcome?.status, "COMPLETED");
    assert.equal(prompts.market.length, beforeMarket, "upstream kept");
    assert.match(prompts.gtm.at(-1)!, /用户要求重跑[\s\S]*小红书/);
    assert.equal(st.nodes.find((n) => n.key === "gtm")!.attempts, 2);
    const ev2 = await listMissionEvents(a.session, m1, events.length);
    assert.ok(ev2.some((e) => e.type === "node.rerun") && ev2.some((e) => e.type === "mission.finished"));
    console.log("  ✔ rerun reopened → completed again");

    console.log("▶ C6 owner-only: another member cannot see or control the mission");
    const other = await prisma.user.create({ data: { organizationId: a.org.id, email: `ctl-other-${tag}@hermes.test`, name: "Other" } });
    await prisma.organizationMember.create({ data: { organizationId: a.org.id, userId: other.id, role: OrgRole.ORG_ADMIN } });
    const otherSession = { userId: other.id, organizationId: a.org.id, userEmail: other.email, userName: other.name };
    await expectReject(listMissionEvents(otherSession, m1), /NotFound/, "events are owner-only");
    await expectReject(controlKernMission(otherSession, m1, { action: "pause" }), /NotFound/, "controls are owner-only");
    console.log("  ✔ NotFound for non-owners");

    // ------------------------------------------------------------------
    const b = await makeOrg(tag, "B");
    const { missionTaskId: m2 } = await launchKernMission(b.session, {
      plan: buildNewProductMissionPlan("另一个新产品"),
      conversationId: null,
      sourceRunId: "ctl-b-" + tag,
    });

    console.log("▶ C7 skipping a critical active step cancels its queued task and flags the outcome");
    const marketTask = (await getKernMissionStatus(b.session, m2)).nodes.find((n) => n.key === "market")!.taskId!;
    const skipped = await controlKernMission(b.session, m2, { action: "skip", nodeKey: "market" });
    assert.equal(skipped.critical, true);
    assert.equal((await prisma.agentTask.findUnique({ where: { id: marketTask } }))!.status, AgentTaskStatus.CANCELLED);
    await expectReject(controlKernMission(b.session, m2, { action: "skip", nodeKey: "synthesis" }), /Unprocessable/, "synthesis cannot be skipped");
    st = await getKernMissionStatus(b.session, m2);
    assert.equal(st.nodes.find((n) => n.key === "opportunity")!.status, "ACTIVE", "downstream proceeds with the gap");
    console.log("  ✔ skipped; downstream continues");

    console.log("▶ C8 cancel stops everything and is final");
    const queuedBefore = st.nodes.filter((n) => n.status === "ACTIVE").map((n) => n.taskId!);
    const cancelled = await controlKernMission(b.session, m2, { action: "cancel" });
    assert.ok((cancelled.skipped as string[]).includes("synthesis"));
    st = await getKernMissionStatus(b.session, m2);
    assert.equal(st.status, AgentTaskStatus.CANCELLED);
    assert.equal(st.outcome?.status, "CANCELLED");
    const kids = await prisma.agentTask.findMany({ where: { id: { in: queuedBefore } }, select: { status: true } });
    assert.ok(kids.every((k) => k.status === AgentTaskStatus.CANCELLED), "queued children cancelled");
    await drain(b.org.id);
    assert.equal((await getKernMissionStatus(b.session, m2)).outcome?.status, "CANCELLED", "worker does not revive it");
    await expectReject(controlKernMission(b.session, m2, { action: "resume" }), /Conflict/, "cannot resume a cancelled mission");
    await expectReject(controlKernMission(b.session, m2, { action: "rerun", nodeKey: "gtm" }), /Conflict/, "cannot rerun a cancelled mission");
    const evB = await listMissionEvents(b.session, m2);
    assert.equal(evB.at(-1)!.type, "mission.cancelled");
    assert.deepEqual(evB.map((e) => e.seq), evB.map((_, i) => i + 1));
    console.log("  ✔ cancelled, final");

    console.log("\n✅ Kern mission controls regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
