import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { sendDepartmentAssistantMessage } from "../src/modules/assistant-runtime/service";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/worker/loops";
import { applyProposal } from "../src/modules/advisor/proposals";
import {
  actOnBrief,
  loadMissionReport,
  missionReportHtml,
  missionReportMarkdown,
  proposeMissionTakeaway,
  setMissionModelInvokerForTest,
  takeawayOptions,
} from "../src/modules/supervisor";

/**
 * Display Layer PR ④ — take-away (real DB, real worker loops):
 *   T1 report reads full node outputs, decision + recommendation
 *   T2 export MD / printable HTML (escaped)
 *   T3 product proposal (idempotent) — nothing written until confirm
 *   T4 confirm → product + project, conversation bound; work-item offered next
 *   T5 work-item proposal under the bound project
 *   T6 demo mission: exportable, never proposable; unfinished mission refused
 *   T7 owner-only
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

const SYNTH = [
  "## 1. 结论与建议：推荐做「随行冷萃杯」",
  "在 200 元价位带做 3 分钟冷萃，差异化清楚。",
  "",
  "| 竞品 | 价格 | 冷萃 |",
  "|---|---|---|",
  "| A | ¥299 | 否 |",
  "",
  "## 5. 需要你决定的事",
  "是否投入约 ¥60k 做 4 周验证。",
].join("\n");

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  process.env.KERN_DEMO_DELAY_MS = "0";
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: "Takeaway Test", code: "TKW_" + tag } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `tkw-${tag}@hermes.test`, name: "Owner" } });
  const other = await prisma.user.create({ data: { organizationId: org.id, email: `tkw2-${tag}@hermes.test`, name: "Other" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: other.id, role: OrgRole.MEMBER } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  const otherSession = { userId: other.id, organizationId: org.id, userEmail: other.email, userName: other.name };
  await bootstrapDefaultWorkforce(session);

  setMissionModelInvokerForTest(async ({ messages }) => {
    const u = messages[messages.length - 1].content;
    const key = /## 你的任务（([^）]+)）/.exec(u)?.[1] ?? "?";
    if (key === "qa") return { text: JSON.stringify({ verdict: "PASS", summary: "ok", issues: [] }), provenance: {} };
    if (key === "synthesis") return { text: SYNTH, provenance: {} };
    if (key === "opportunity") return { text: "候选 A：随行冷萃杯\n- 核心卖点：3 分钟冷萃、单手操作\n- 目标用户：通勤白领", provenance: {} };
    return { text: `${key} 的完整产出：${"细节".repeat(3000)}`, provenance: {} };
  });

  try {
    const chat = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: "Kern" } });
    const turn = await sendDepartmentAssistantMessage(session, chat.id, "我想开发一个新产品：便携咖啡机");
    const mid = turn.message.id;
    await actOnBrief(session, mid, { action: "answer", answers: { audience: { optionId: "young-pro" }, channel: { optionId: "online" } } });
    const launched = await actOnBrief(session, mid, { action: "launch" });
    const missionId = launched.brief.missionTaskId!;
    await drain(org.id);

    console.log("▶ T1 report: full outputs, decision, recommendation");
    const report = await loadMissionReport(session, missionId);
    assert.equal(report.outcome, "COMPLETED");
    assert.equal(report.title, "我想开发一个新产品：便携咖啡机");
    assert.equal(report.recommendation, "随行冷萃杯");
    assert.equal(report.decision, "是否投入约 ¥60k 做 4 周验证。");
    const market = report.steps.find((s) => s.key === "market")!;
    assert.ok((market.output ?? "").length > 4000, "full output, not the 4000-char summary");
    assert.deepEqual(report.constraints.map((c) => c.answer).sort(), ["城市年轻白领", "线上电商 / 内容平台"].sort());
    console.log("  ✔ report");

    console.log("▶ T2 export");
    const md = missionReportMarkdown(report);
    assert.match(md, /## 需要你决定\n\n是否投入约 ¥60k/);
    assert.match(md, /\| 竞品 \| 价格 \| 冷萃 \|/);
    const html = missionReportHtml(report, md);
    assert.match(html, /<th>竞品<\/th>/);
    assert.match(html, /window\.print/);
    console.log("  ✔ md + printable html");

    console.log("▶ T3 product proposal (idempotent, nothing written yet)");
    const opts = await takeawayOptions(session, missionId);
    assert.deepEqual({ blocked: opts.blocked, product: opts.product, workItem: opts.workItem }, { blocked: null, product: true, workItem: false });
    const productsBefore = await prisma.product.count({ where: { organizationId: org.id } });
    const p1 = await proposeMissionTakeaway(session, { missionTaskId: missionId, target: "product" });
    const p2 = await proposeMissionTakeaway(session, { missionTaskId: missionId, target: "product" });
    assert.equal(p1.created, true);
    assert.equal(p2.created, false);
    assert.equal(p2.proposalId, p1.proposalId);
    const row = await prisma.actionProposal.findUniqueOrThrow({ where: { id: p1.proposalId } });
    const payload = row.payloadJson as Record<string, string>;
    assert.equal(row.conversationId, chat.id);
    assert.equal(payload.name, "随行冷萃杯");
    assert.equal(payload.targetAudience, "城市年轻白领");
    assert.equal(payload.targetChannels, "线上电商 / 内容平台");
    assert.match(payload.coreSellingPoints, /3 分钟冷萃/);
    assert.equal(await prisma.product.count({ where: { organizationId: org.id } }), productsBefore, "no business write before confirm");
    console.log("  ✔ proposal", payload.name);

    console.log("▶ T4 confirm → product + project, conversation bound");
    const receipt = await applyProposal(session, p1.proposalId, { idempotencyKey: `t4-${tag}` });
    assert.ok(receipt);
    const bound = await prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } });
    assert.ok(bound.productId, "conversation bound to new product");
    const opts2 = await takeawayOptions(session, missionId);
    assert.equal(opts2.product, false);
    assert.equal(opts2.workItem, true);
    assert.ok(opts2.project);
    console.log("  ✔ confirmed; project", opts2.project!.title);

    console.log("▶ T5 work-item proposal under the bound project");
    const w = await proposeMissionTakeaway(session, { missionTaskId: missionId, target: "work-item" });
    const wrow = await prisma.actionProposal.findUniqueOrThrow({ where: { id: w.proposalId } });
    assert.equal(wrow.actionType, "CREATE_WORK_ITEM");
    assert.equal(wrow.projectId, opts2.project!.id);
    assert.match((wrow.payloadJson as Record<string, string>).title, /落实：随行冷萃杯/);
    console.log("  ✔ work-item proposal");

    console.log("▶ T6 demo: export ok, take-away refused; unfinished refused");
    const chat2 = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: "Kern" } });
    const t2 = await sendDepartmentAssistantMessage(session, chat2.id, "我想开发一个新产品：智能水杯");
    await actOnBrief(session, t2.message.id, { action: "skip-questions" });
    const demo = await actOnBrief(session, t2.message.id, { action: "launch", demo: true });
    const demoId = demo.brief.missionTaskId!;
    await expectReject(proposeMissionTakeaway(session, { missionTaskId: demoId, target: "product" }), /Unprocessable.*演示/, "demo (even unfinished) refused");
    await drain(org.id);
    const demoReport = await loadMissionReport(session, demoId);
    assert.equal(demoReport.demo, true);
    assert.match(missionReportMarkdown(demoReport), /演示模式/);
    assert.match((await takeawayOptions(session, demoId)).blocked ?? "", /演示/);
    await expectReject(proposeMissionTakeaway(session, { missionTaskId: demoId, target: "product" }), /Unprocessable.*演示/, "demo refused");
    const chat3 = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: owner.id, title: "Kern" } });
    const t3 = await sendDepartmentAssistantMessage(session, chat3.id, "我想开发一个新产品：保温饭盒");
    await actOnBrief(session, t3.message.id, { action: "skip-questions" });
    const running = await actOnBrief(session, t3.message.id, { action: "launch" });
    await expectReject(proposeMissionTakeaway(session, { missionTaskId: running.brief.missionTaskId!, target: "product" }), /Conflict/, "unfinished refused");
    console.log("  ✔ demo + unfinished refused");

    console.log("▶ T7 owner-only");
    await expectReject(loadMissionReport(otherSession, missionId), /NotFound/, "other user cannot export");
    await expectReject(proposeMissionTakeaway(otherSession, { missionTaskId: missionId, target: "product" }), /NotFound/, "other user cannot propose");
    console.log("  ✔ owner-only");

    console.log("\n✅ Kern take-away regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
