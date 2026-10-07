import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/supervisor/worker-runtime";
import {
  buildNewProductMissionPlan,
  controlKernMission,
  getKernMissionStatus,
  launchKernMission,
  listMissionEvents,
  parseMissionControl,
  setMissionModelInvokerForTest,
} from "../src/modules/supervisor";

/**
 * KX-50 / KX-51b（真实数据库 + 真实 worker 循环 + 假模型）：
 *   提问不阻塞，先按默认假设完成；之后回答 → 重开任务、重做该步骤并记住答案；
 *   确认假设 → 不重做；步骤还在跑时回答 → 作废本次执行、带着回答重派；中止 → 取消。
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
  const org = await prisma.organization.create({ data: { name: `Ask ${label}`, code: `ASK_${label}_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `ask-${label}-${tag}@hermes.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  await bootstrapDefaultWorkforce(session);
  return { org, session };
}

type Session = Parameters<typeof getKernMissionStatus>[0];
async function waitForAsk(session: Session, missionId: string) {
  for (let i = 0; i < 150; i++) {
    const st = await getKernMissionStatus(session, missionId);
    if (st.pendingAsks.length) return st.pendingAsks[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no pending ask appeared");
}

const fence = (o: unknown) => "```kern-tool\n" + JSON.stringify(o) + "\n```";
const stub = (text: string) => ({ text, provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } });

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);

  const seen: Record<string, string[]> = {};
  let gate: Promise<void> | null = null;
  let prohibit = false;
  let release: () => void = () => {};
  const closeGate = () => {
    gate = new Promise<void>((r) => (release = r));
  };
  setMissionModelInvokerForTest(async ({ messages }) => {
    const all = messages.map((m) => m.content).join("\n");
    const key = /## 你的任务（([^）]+)）/.exec(all)?.[1] ?? "?";
    const last = messages[messages.length - 1].content;
    const observed = /## 工具结果/.test(last);
    (seen[key] ??= []).push(all);
    if (key === "qa") return stub(JSON.stringify({ verdict: "PASS", summary: "可以交付", issues: [] }));
    if (key === "synthesis") return stub("结论：推荐方向 A。");
    const answered = /用户回答了你之前的提问/.test(all);
    if (key === "market" && !observed && !answered) {
      return stub(fence({ tool: "ask_user", input: { question: "只做线上渠道吗？", defaultAssumption: "线上线下都考虑" } }));
    }
    if (key === "market" && observed && gate) await gate;
    if (key === "economics" && !observed) return stub(fence({ tool: "calculate", input: { expression: "199*0.4" } }));
    if (key === "compliance") return stub(`compliance 的结论。\n合规判定：${prohibit ? "禁止" : "可做"}`);
    return stub(answered ? "market 按用户回答：只做线上。" : `${key} 的结论。`);
  });

  try {
    const a = await makeOrg(tag, "A");
    const plan = () => buildNewProductMissionPlan("我想开发一个新产品");
    const launch = async (n: string) =>
      (await launchKernMission(a.session, { plan: plan(), conversationId: null, sourceRunId: `${n}-${tag}` })).missionTaskId;

    console.log("▶ A0 answer 控制参数校验");
    assert.throws(() => parseMissionControl({ action: "answer", askId: "x", mode: "answer" }), /Invalid/);
    assert.throws(() => parseMissionControl({ action: "answer", askId: "x", mode: "maybe" }), /Invalid/);

    console.log("▶ A1 提问不阻塞 → 任务先完成；之后回答 → 重开并重做该步骤，记住答案");
    const m1 = await launch("ask1");
    await drain(a.org.id);
    let st = await getKernMissionStatus(a.session, m1);
    assert.equal(st.outcome?.status, "COMPLETED", "提问不阻塞任务");
    assert.equal(st.pendingAsks.length, 1, "完成后问题仍可回答");
    assert.equal(st.pendingAsks[0].nodeKey, "market");
    assert.ok(seen.market.some((p) => /问题已转给用户[\s\S]*线上线下都考虑/.test(p)));
    assert.ok(seen.economics.some((p) => /199\*0\.4 = 79\.6/.test(p)), "计算工具结果回喂");
    await assert.rejects(controlKernMission(a.session, m1, { action: "answer", askId: randomUUID(), mode: "ignore" }), /NotFound|not found/);
    const r1 = await controlKernMission(a.session, m1, { action: "answer", askId: st.pendingAsks[0].askId, mode: "answer", text: "只做线上" });
    assert.equal(r1.applied, "rerun");
    assert.equal(r1.reopened, true);
    assert.ok((r1.resetKeys as string[]).includes("market"));
    await drain(a.org.id);
    st = await getKernMissionStatus(a.session, m1);
    assert.equal(st.outcome?.status, "COMPLETED");
    assert.equal(st.pendingAsks.length, 0);
    assert.ok(st.nodes.find((n) => n.key === "market")!.attempts >= 2);
    assert.ok(seen.market.some((p) => /用户回答了你之前的提问「只做线上渠道吗？」：只做线上/.test(p)));
    const mem = await prisma.kernMemory.findFirst({ where: { userId: a.session.userId, source: `mission-ask:${r1.askId}` } });
    assert.match(mem?.content ?? "", /只做线上渠道吗？ → 只做线上/);
    await assert.rejects(controlKernMission(a.session, m1, { action: "answer", askId: String(r1.askId), mode: "ignore" }), /already answered/);
    const ev1 = await listMissionEvents(a.session, m1);
    assert.ok(ev1.some((e) => e.type === "node.rerun" && e.payload.reason === "USER_ANSWERED"));
    assert.ok(ev1.some((e) => e.type === "node.tool" && e.payload.tool === "calculate"));
    // KX-53：关键帧带真实进度，结束帧为 100。
    const frames = ev1.filter((e) => e.type === "node.finished" || e.type === "node.dispatched");
    assert.ok(frames.length && frames.every((e) => typeof (e.payload.progress as { pct?: unknown })?.pct === "number"));
    assert.equal((ev1.filter((e) => e.type === "mission.finished").at(-1)!.payload.progress as { pct: number }).pct, 100);
    assert.equal(st.progress.pct, 100);
    console.log("  ✔ 先完成、后修正、已记住");

    console.log("▶ A2 确认假设 → 不重做");
    const m2 = await launch("ask2");
    await drain(a.org.id);
    const ask2 = (await getKernMissionStatus(a.session, m2)).pendingAsks[0];
    const r2 = await controlKernMission(a.session, m2, { action: "answer", askId: ask2.askId, mode: "ignore" });
    assert.equal(r2.applied, "none");
    st = await getKernMissionStatus(a.session, m2);
    assert.equal(st.outcome?.status, "COMPLETED");
    assert.equal(st.pendingAsks.length, 0);
    assert.equal(st.nodes.find((n) => n.key === "market")!.attempts, 1);
    console.log("  ✔ 不重做");

    console.log("▶ A3 步骤还在跑时回答 → 作废本次执行，带着回答重派");
    closeGate();
    const m3 = await launch("ask3");
    const run3 = drain(a.org.id);
    const ask3 = await waitForAsk(a.session, m3);
    const r3 = await controlKernMission(a.session, m3, { action: "answer", askId: ask3.askId, mode: "answer", text: "只做线上" });
    assert.equal(r3.applied, "rerun");
    assert.deepEqual(r3.resetKeys, ["market"]);
    gate = null;
    release();
    await run3;
    await drain(a.org.id);
    st = await getKernMissionStatus(a.session, m3);
    assert.equal(st.outcome?.status, "COMPLETED", JSON.stringify(st.outcome));
    const market3 = st.nodes.find((n) => n.key === "market")!;
    assert.ok(market3.attempts >= 2);
    assert.match(market3.summary ?? "", /按用户回答/);
    console.log("  ✔ 重派后按回答完成");

    console.log("▶ A4 在提问处中止 → 任务取消");
    closeGate();
    const m4 = await launch("ask4");
    const run4 = drain(a.org.id);
    const ask4 = await waitForAsk(a.session, m4);
    await controlKernMission(a.session, m4, { action: "answer", askId: ask4.askId, mode: "abort" });
    gate = null;
    release();
    await run4;
    st = await getKernMissionStatus(a.session, m4);
    assert.equal(st.outcome?.status, "CANCELLED");
    assert.equal(st.pendingAsks.length, 0);
    console.log("  ✔ 中止生效");

    console.log("▶ A5 条件跳过（KX-54）：合规判定=禁止 → 营销不做，写明原因，任务仍完成");
    prohibit = true;
    const gtmCallsBefore = seen.gtm?.length ?? 0;
    const conv = await prisma.conversation.create({ data: { organizationId: a.org.id, ownerId: a.session.userId, title: "条件跳过" } });
    const m5 = (await launchKernMission(a.session, { plan: plan(), conversationId: conv.id, sourceRunId: `ask5-${tag}` })).missionTaskId;
    await drain(a.org.id);
    st = await getKernMissionStatus(a.session, m5);
    assert.equal(st.outcome?.status, "COMPLETED", JSON.stringify(st.outcome));
    const gtm5 = st.nodes.find((n) => n.key === "gtm")!;
    assert.equal(gtm5.status, "SKIPPED");
    assert.equal(gtm5.reason, "CONDITION_compliance_PROHIBITED");
    assert.equal(seen.gtm?.length ?? 0, gtmCallsBefore, "营销从未被派发");
    const ev5 = await listMissionEvents(a.session, m5);
    assert.ok(ev5.some((e) => e.type === "node.finished" && e.nodeKey === "compliance" && JSON.stringify(e.payload.signals) === '["PROHIBITED"]'));
    assert.ok(ev5.some((e) => e.type === "node.skipped" && e.nodeKey === "gtm" && e.payload.reason === "CONDITION_compliance_PROHIBITED"));
    const report = await prisma.message.findFirst({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" } });
    assert.match(report?.content ?? "", /按计划跳过：[^\n]*判定为禁止/);
    assert.doesNotMatch(report?.content ?? "", /按 UNKNOWN 处理：[^\n]*营销/);
    prohibit = false;
    console.log("  ✔ 营销被跳过且原因可见");

    console.log("\n✅ Kern node ask regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    release();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
