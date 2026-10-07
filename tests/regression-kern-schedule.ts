/**
 * KX-34 定时与主动 — 真实数据库回归。
 *  SC1 创建校验：坏 cron / 坏时区 / 提醒缺内容 / 重复每日简报 → 422；他人 404
 *  SC2 提醒到期 → 发到对话，nextRunAt 前移；再跑一次不重复
 *  SC3 两个 worker 并发认领同一到期定时 → 只执行一次
 *  SC4 每日简报：没内容不发；有任务结束后再发，内容来自真实任务
 *  SC5 定时重跑：先要「保存为做法 + 复核通过 + 连续验收 3 次」(KX-73)，然后按原计划以本人身份启动新任务
 *  SC6 连续失败 5 次自动停用
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce, scheduleLoopOnce } from "../src/modules/supervisor/worker-runtime";
import { buildNewProductMissionPlan, buildTaskContract, controlKernMission, getKernMissionStatus, launchKernMission, readMissionSnapshot, setMissionModelInvokerForTest } from "../src/modules/supervisor";
import { savePlaybookFromMission } from "../src/modules/playbooks/service";
import { createSchedule, deleteSchedule, listSchedules, parseCreateSchedule, runDueSchedules, updateSchedule } from "../src/modules/schedule/service";

async function drain(organizationId: string, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0 && (await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } })) === 0) return;
  }
}
const stub = (text: string) => ({ text, provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } });

async function rejects422(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, (e: { statusCode?: number; message: string }) => e.statusCode === 422 && re.test(e.message));
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID().slice(0, 8);
  setMissionModelInvokerForTest(async ({ messages }) => {
    const all = messages.map((m) => m.content).join("\n");
    const key = /## 你的任务（([^）]+)）/.exec(all)?.[1] ?? "?";
    if (key === "qa") return stub(JSON.stringify({ verdict: "PASS", summary: "可以交付", issues: [] }));
    if (key === "compliance") return stub("结论。\n合规判定：可做");
    if (key === "synthesis") return stub("推荐做「方向 A」。\n## 结论与建议\n推荐方向 A。\n## 关键依据\n- 事实：市场在增长。\n## 待验证与下一步\n## 主要风险\n## 需要你决定的事\n目前不需要你决定");
    return stub(`${key} 的结论。`);
  });

  const org = await prisma.organization.create({ data: { name: "Schedule", code: `SCH_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `sch-${tag}@hermes.test`, name: "Owner" } });
  const other = await prisma.user.create({ data: { organizationId: org.id, email: `sch2-${tag}@hermes.test`, name: "Other" } });
  await prisma.organizationMember.createMany({ data: [{ organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN }, { organizationId: org.id, userId: other.id, role: OrgRole.ORG_ADMIN }] });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  const otherSession = { userId: other.id, organizationId: org.id, userEmail: other.email, userName: other.name };
  await bootstrapDefaultWorkforce(session);
  const makeDue = (id: string, at = new Date(Date.now() - 60_000)) => prisma.kernSchedule.update({ where: { id }, data: { nextRunAt: at } });
  const msgs = (id: string) => prisma.message.findMany({ where: { citations: { array_contains: [{ kind: "kern-schedule", ref: id }] } } });

  try {
    console.log("▶ SC1 创建校验与越权");
    assert.throws(() => parseCreateSchedule({ kind: "X", cron: "0 9 * * *" }), /kind/);
    assert.throws(() => parseCreateSchedule({ kind: "REMINDER", cron: "0 9 * * *" }), /text/);
    await rejects422(createSchedule(session, { kind: "REMINDER", cron: "0 25 * * *", text: "x" }), /定时表达式无效/);
    await rejects422(createSchedule(session, { kind: "REMINDER", cron: "0 9 * * *", text: "x", timezone: "Mars/Base" }), /未知时区/);
    await rejects422(createSchedule(session, { kind: "REMINDER", cron: "0 0 30 2 *", text: "x" }), /永远不会触发/);
    const brief = await createSchedule(session, { kind: "DAILY_BRIEF", cron: "0 9 * * *" });
    assert.equal(brief.cronText, "每天 09:00");
    assert.ok(brief.nextRunAt && new Date(brief.nextRunAt) > new Date());
    await rejects422(createSchedule(session, { kind: "DAILY_BRIEF", cron: "0 8 * * *" }), /已经有一个每日简报/);
    await assert.rejects(updateSchedule(otherSession, brief.id, { enabled: false }), /not found/i);
    await assert.rejects(deleteSchedule(otherSession, brief.id), /not found/i);
    assert.equal((await listSchedules(otherSession)).length, 0);

    console.log("▶ SC2 提醒到期 → 发到对话；不重复");
    const rem = await createSchedule(session, { kind: "REMINDER", cron: "0 10 * * 1", text: "看一下竞品定价" });
    await makeDue(rem.id);
    const r1 = await scheduleLoopOnce({ organizationId: org.id });
    assert.equal(r1.acted, 1);
    const posted = await msgs(rem.id);
    assert.equal(posted.length, 1);
    assert.match(posted[0].content, /提醒：看一下竞品定价/);
    const conv = await prisma.conversation.findUnique({ where: { id: posted[0].conversationId } });
    assert.equal(conv?.ownerId, owner.id);
    assert.equal(conv?.title, "Kern 简报");
    const after = await prisma.kernSchedule.findUnique({ where: { id: rem.id } });
    assert.ok(after!.nextRunAt! > new Date(), "nextRunAt 前移到未来");
    assert.equal(after!.lastStatus, "POSTED");
    await scheduleLoopOnce({ organizationId: org.id });
    assert.equal((await msgs(rem.id)).length, 1, "再跑不重复");

    console.log("▶ SC3 并发认领只执行一次");
    await makeDue(rem.id);
    const [a, b] = await Promise.all([runDueSchedules({ organizationId: org.id }), runDueSchedules({ organizationId: org.id })]);
    const executed = [...a.results, ...b.results].filter((x) => x.id === rem.id && x.outcome !== "LOST_CLAIM").length;
    assert.equal(executed, 1);
    assert.equal((await msgs(rem.id)).length, 2);

    console.log("▶ SC4 每日简报：没内容不发，有内容才发");
    await makeDue(brief.id);
    await scheduleLoopOnce({ organizationId: org.id });
    let bRow = await prisma.kernSchedule.findUnique({ where: { id: brief.id } });
    assert.equal(bRow!.lastStatus, "SKIPPED_EMPTY");
    assert.equal((await msgs(brief.id)).length, 0);
    const sc4Plan = buildNewProductMissionPlan("我想开发一个宠物饮水机");
    const launched = await launchKernMission(session, { plan: sc4Plan, contract: buildTaskContract({ plan: sc4Plan, answers: [] }), conversationId: null, sourceRunId: `sc4-${tag}` });
    await drain(org.id);
    const snap = readMissionSnapshot((await prisma.agentTask.findUnique({ where: { id: launched.missionTaskId } }))!.contextSnapshot);
    assert.ok(snap?.outcome, "任务已结束");
    await makeDue(brief.id);
    await scheduleLoopOnce({ organizationId: org.id });
    bRow = await prisma.kernSchedule.findUnique({ where: { id: brief.id } });
    assert.equal(bRow!.lastStatus, "POSTED");
    const digest = await msgs(brief.id);
    assert.equal(digest.length, 1);
    assert.match(digest[0].content, /今日简报/);
    assert.match(digest[0].content, /宠物饮水机/);
    // 再次到期且没有新结束的任务 → 又回到静默（「需要你」若有仍会发，这里任务已完成无待办）
    await makeDue(brief.id);
    await scheduleLoopOnce({ organizationId: org.id });
    bRow = await prisma.kernSchedule.findUnique({ where: { id: brief.id } });
    assert.ok(["SKIPPED_EMPTY", "POSTED"].includes(bRow!.lastStatus!));

    console.log("▶ SC5 定时重跑：KX-73 三次成功才自动化，然后按原计划以本人身份启动");
    // 没保存为做法 → 不能转定时
    await rejects422(createSchedule(session, { kind: "MISSION", cron: "0 9 * * 1", missionTaskId: launched.missionTaskId }), /保存为做法|连续/);
    let st = await getKernMissionStatus(session, launched.missionTaskId);
    assert.equal(st.automation?.allowed, false);
    // 保存为做法并把这次任务记在做法名下；前两次验收已通过（直接写 streak=2），这次复核通过后到 3
    const pb = await savePlaybookFromMission(session, launched.missionTaskId, `做法-${tag}`);
    await prisma.kernPlaybook.update({ where: { id: pb.item.id }, data: { acceptedStreak: 2 } });
    const rootRow = await prisma.agentTask.findUnique({ where: { id: launched.missionTaskId }, select: { contextSnapshot: true } });
    await prisma.agentTask.update({
      where: { id: launched.missionTaskId },
      data: { contextSnapshot: { ...(rootRow!.contextSnapshot as Record<string, unknown>), playbookRef: { id: pb.item.id, name: pb.item.name } } },
    });
    await rejects422(createSchedule(session, { kind: "MISSION", cron: "0 9 * * 1", missionTaskId: launched.missionTaskId }), /复核/);
    const reviewed = await controlKernMission(session, launched.missionTaskId, { action: "review", verdicts: [] });
    assert.equal(reviewed.accepted, true, JSON.stringify(reviewed));
    st = await getKernMissionStatus(session, launched.missionTaskId);
    assert.ok(st.metrics && st.metrics.completed && st.metrics.accepted === true, "metrics recorded: " + JSON.stringify(st.metrics));
    assert.equal(st.metrics!.cost.modelCalls > 0, true, "model calls counted");
    assert.equal(st.automation?.allowed, true, JSON.stringify(st.automation));
    assert.equal(st.automation?.streak, 3);
    assert.equal((await prisma.kernPlaybook.findUnique({ where: { id: pb.item.id } }))!.acceptedStreak, 3);
    const rerun = await createSchedule(session, { kind: "MISSION", cron: "0 9 * * 1", missionTaskId: launched.missionTaskId });
    assert.match(rerun.title, /重跑：/);
    await assert.rejects(createSchedule(otherSession, { kind: "MISSION", cron: "0 9 * * 1", missionTaskId: launched.missionTaskId }), /Mission not found/);
    await makeDue(rerun.id);
    const before = await prisma.agentTask.count({ where: { organizationId: org.id, parentTaskId: null, contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" } } });
    await scheduleLoopOnce({ organizationId: org.id });
    const rRow = await prisma.kernSchedule.findUnique({ where: { id: rerun.id } });
    assert.equal(rRow!.lastStatus, "LAUNCHED", rRow!.lastError ?? "");
    const nowCount = await prisma.agentTask.count({ where: { organizationId: org.id, parentTaskId: null, contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" } } });
    assert.equal(nowCount, before + 1);
    const newest = await prisma.agentTask.findFirst({ where: { organizationId: org.id, contextSnapshot: { path: ["sourceRunId"], string_starts_with: `schedule:${rerun.id}:` } } });
    assert.equal(newest?.createdByUserId, owner.id);
    assert.equal(readMissionSnapshot(newest!.contextSnapshot)?.requestedByUserId, owner.id);
    assert.equal(readMissionSnapshot(newest!.contextSnapshot)?.playbookRef?.id, pb.item.id, "scheduled run counts toward the playbook");

    console.log("▶ SC6 连续失败 5 次自动停用");
    await prisma.kernSchedule.update({ where: { id: rerun.id }, data: { payload: {} } });
    for (let i = 0; i < 5; i++) {
      await makeDue(rerun.id);
      await scheduleLoopOnce({ organizationId: org.id });
    }
    const dead = await prisma.kernSchedule.findUnique({ where: { id: rerun.id } });
    assert.equal(dead!.enabled, false);
    assert.equal(dead!.consecutiveFailures, 5);
    assert.match(dead!.lastError ?? "", /缺少计划/);
    const revived = await updateSchedule(session, rerun.id, { enabled: true });
    assert.equal(revived.enabled, true);
    assert.equal(revived.lastError, null);

    console.log("\n✅ Kern schedule regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.kernSchedule.deleteMany({ where: { organizationId: org.id } });
    await prisma.kernPlaybook.deleteMany({ where: { organizationId: org.id } });
    await prisma.kernMissionEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.id, other.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
