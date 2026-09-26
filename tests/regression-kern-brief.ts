import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, KernMemoryKind, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { sendDepartmentAssistantMessage } from "../src/modules/assistant-runtime/service";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/worker/loops";
import { getUsage } from "../src/modules/billing";
import {
  actOnBrief,
  getBrief,
  getKernMissionStatus,
  listMissionEvents,
  setMissionModelInvokerForTest,
} from "../src/modules/supervisor";

/**
 * Display Layer PR ③ — brief (clarify → plan → confirm) and demo mode
 * (real DB, real worker loops):
 *   chat creates a brief, not a mission · memory pre-fills “我记得” ·
 *   answers become plan constraints · plan edits · launch is idempotent ·
 *   demo runs end-to-end with no model call and no quota · owner-only.
 */

async function drain(organizationId: string, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0 && (await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } })) === 0) return;
  }
}

async function expectReject(p: Promise<unknown>, pattern: RegExp, msg: string) {
  await assert.rejects(p, (e: unknown) => pattern.test(`${(e as Error)?.constructor?.name} ${(e as Error)?.message}`), msg);
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  process.env.KERN_DEMO_DELAY_MS = "0";
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: "Brief Test", code: "BRF_" + tag } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `brf-${tag}@hermes.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  await bootstrapDefaultWorkforce(session);
  await prisma.kernMemory.create({
    data: { organizationId: org.id, userId: owner.id, kind: KernMemoryKind.PREFERENCE, content: "新项目预算一般控制在 30 万以内" },
  });

  let realCalls = 0;
  const seen: Record<string, string> = {};
  setMissionModelInvokerForTest(async ({ messages }) => {
    realCalls++;
    const u = messages[messages.length - 1].content;
    const key = /## 你的任务（([^）]+)）/.exec(u)?.[1] ?? "?";
    seen[key] = u;
    if (key === "qa") return { text: JSON.stringify({ verdict: "PASS", summary: "ok", issues: [] }), provenance: {} };
    return { text: `${key} 结论`, provenance: {} };
  });

  try {
    console.log("▶ B1 chat creates a clarify brief with memory pre-filled; nothing runs");
    const chat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: "Kern" } });
    const tasksBefore = await prisma.agentTask.count({ where: { organizationId: org.id, parentTaskId: null, contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" } } });
    const turn = await sendDepartmentAssistantMessage(session, chat.id, "我想开发一个新产品");
    assert.equal(turn.brief?.stage, "CLARIFY", String(turn.missionError));
    assert.equal(turn.mission, null);
    const mid = turn.message.id;
    let b = await getBrief(session, mid);
    assert.deepEqual(b.brief.questions.map((q) => q.id), ["audience", "budget", "channel"]);
    const budget = b.brief.questions.find((q) => q.id === "budget")!;
    assert.match(budget.remembered?.text ?? "", /30 万/, "memory pre-fills 我记得");
    assert.equal(budget.answer?.text, budget.remembered?.text);
    assert.equal(b.estimate, null);
    assert.equal(
      await prisma.agentTask.count({ where: { organizationId: org.id, parentTaskId: null, contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" } } }),
      tasksBefore,
      "no mission before confirmation"
    );
    console.log("  ✔ brief, not mission; 我记得 pre-filled");

    console.log("▶ B2 answers become plan constraints; estimate shown; plan editable");
    b = await actOnBrief(session, mid, {
      action: "answer",
      answers: { audience: { optionId: "young-pro" }, channel: { optionId: "open" } },
    });
    assert.equal(b.brief.stage, "PLAN");
    assert.match(b.brief.plan!.goal, /主要卖给谁：城市年轻白领/);
    assert.match(b.brief.plan!.goal, /预算.*30 万/, "remembered answer kept");
    assert.doesNotMatch(b.brief.plan!.goal, /渠道/, "'let the team decide' is not a constraint");
    assert.equal(b.brief.memoriesUsed.length, 1);
    assert.equal(b.estimate?.steps, 9);
    assert.equal(b.estimate?.quota?.used, 0);
    assert.equal(b.estimate?.quota?.afterLaunch, 1);
    b = await actOnBrief(session, mid, { action: "edit-plan", edits: [{ op: "remove", key: "gtm" }] });
    assert.ok(!b.brief.plan!.nodes.some((n) => n.key === "gtm"));
    await expectReject(actOnBrief(session, mid, { action: "edit-plan", edits: [{ op: "remove", key: "qa" }] }), /STRUCTURAL/, "QA is structural");
    b = await actOnBrief(session, mid, { action: "back" });
    assert.equal(b.brief.stage, "CLARIFY");
    b = await actOnBrief(session, mid, { action: "answer", answers: { audience: { optionId: "family" } } });
    assert.match(b.brief.plan!.goal, /家庭/);
    console.log("  ✔ constraints, estimate, edit, back");

    console.log("▶ B3 owner-only");
    const other = await prisma.user.create({ data: { organizationId: org.id, email: `brf-o-${tag}@hermes.test`, name: "O" } });
    const os = { userId: other.id, organizationId: org.id, userEmail: other.email, userName: other.name };
    await expectReject(getBrief(os, mid), /NotFound/, "brief is owner-only");
    await expectReject(actOnBrief(os, mid, { action: "launch" }), /NotFound/, "launch is owner-only");
    console.log("  ✔ NotFound for non-owners");

    console.log("▶ B4 launch is idempotent, memory + constraints reach the team");
    b = await actOnBrief(session, mid, { action: "launch" });
    const again = await actOnBrief(session, mid, { action: "launch" });
    assert.equal(again.brief.missionTaskId, b.brief.missionTaskId);
    await expectReject(actOnBrief(session, mid, { action: "back" }), /Conflict/, "cannot edit after launch");
    const msg = await prisma.message.findUnique({ where: { id: mid } });
    assert.ok((msg!.citations as { kind: string }[]).some((c) => c.kind === "kern-mission"), "mission card attached");
    await drain(org.id);
    const real = await getKernMissionStatus(session, b.brief.missionTaskId!);
    assert.equal(real.outcome?.status, "COMPLETED");
    assert.equal(real.memoriesUsed.length, 1);
    assert.match(seen.market, /已确认的约束[\s\S]*家庭/);
    assert.ok(realCalls > 0);
    assert.equal((await getUsage(org.id)).used.missions, 1);
    console.log("  ✔ real mission completed with constraints");

    console.log("▶ B5 demo: full run, zero model calls, zero quota, clearly labelled");
    const callsBefore = realCalls;
    const turn2 = await sendDepartmentAssistantMessage(session, chat.id, "我想开发一个新产品：宠物饮水机");
    await actOnBrief(session, turn2.message.id, { action: "skip-questions" });
    const demo = await actOnBrief(session, turn2.message.id, { action: "launch", demo: true });
    assert.equal(demo.brief.demo, true);
    await drain(org.id);
    const ds = await getKernMissionStatus(session, demo.brief.missionTaskId!);
    assert.equal(ds.demo, true);
    assert.equal(ds.outcome?.status, "COMPLETED", JSON.stringify(ds.outcome));
    assert.equal(realCalls, callsBefore, "demo never calls the model");
    assert.equal(await prisma.modelRun.count({ where: { organizationId: org.id } }), 0, "no ModelRun rows");
    assert.equal((await getUsage(org.id)).used.missions, 1, "demo does not consume mission quota");
    const ev = await listMissionEvents(session, demo.brief.missionTaskId!);
    assert.ok(ev.every((e) => e.demo), "every demo event is flagged");
    assert.ok(ev.filter((e) => e.type === "node.delta" && e.payload.streamed === true).length > 5, "chunked replay");
    assert.ok(ev.some((e) => e.type === "qa.revise"), "demo shows a QA challenge");
    const fin = ev.find((e) => e.type === "node.finished" && e.nodeKey === "market")!;
    assert.match(String(fin.payload.model), /示例/);
    console.log("  ✔ demo completed with QA revise, no model, no quota");

    console.log("▶ B6 dismiss leaves nothing behind");
    const turn3 = await sendDepartmentAssistantMessage(session, chat.id, "我想开发一个新产品：咖啡");
    const d = await actOnBrief(session, turn3.message.id, { action: "dismiss" });
    assert.equal(d.brief.stage, "DISMISSED");
    await expectReject(actOnBrief(session, turn3.message.id, { action: "launch" }), /Conflict/, "dismissed brief cannot launch");
    console.log("  ✔ dismissed");

    console.log("\n✅ Kern brief + demo regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
