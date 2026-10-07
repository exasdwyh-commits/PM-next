/**
 * KX-34b Worker 崩溃恢复 — 真实数据库回归。
 *  WR1 执行中崩溃（持有者无心跳）→ 自动重新排队，AgentRun 关闭为 FAILED，租约清除；重复扫描幂等
 *  WR2 持有者心跳新鲜 → 即使租约过期也不动；心跳失联后才接管
 *  WR3 重试次数用完 → FAILED；任务根（supervising，无租约）从不被误伤
 *  WR4 恢复后继续推进，任务得出结果，不会挂起
 *  WR5 runPmWorker 写心跳，退出时标记停止；健康接口能看到
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentTaskStatus, OrgRole } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { bootstrapDefaultWorkforce, startAgentTask } from "../src/modules/workforce/service";
import { executorLoopOnce, reconcileLoopOnce } from "../src/modules/supervisor/worker-runtime";
import { claimAgentTaskForExecution } from "../src/modules/worker/claim";
import { resolveWorkerSession } from "../src/modules/worker/identity";
import { recoverOrphanedTasks } from "../src/modules/worker/recovery";
import { PROCESS_WORKER_ID, getWorkerHealth } from "../src/modules/worker/heartbeat";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { buildNewProductMissionPlan, getKernMissionStatus, launchKernMission, setMissionModelInvokerForTest } from "../src/modules/supervisor";

const stub = (text: string) => ({ text, provenance: { provider: "stub", modelId: "stub-1", modelRunId: null } });

async function drain(organizationId: string, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const r = await executorLoopOnce({ organizationId, limit: 10 });
    await reconcileLoopOnce({ organizationId });
    if (r.acted === 0 && (await prisma.agentTask.count({ where: { organizationId, status: AgentTaskStatus.QUEUED } })) === 0) return;
  }
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
    return stub(`${key} 的结论。`);
  });
  const org = await prisma.organization.create({ data: { name: "Recovery", code: `REC_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `rec-${tag}@hermes.test`, name: "Owner" } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: OrgRole.ORG_ADMIN } });
  const session = { userId: owner.id, organizationId: org.id, userEmail: owner.email, userName: owner.name };
  await bootstrapDefaultWorkforce(session);
  const worker = await resolveWorkerSession(org.id);
  const fakeWorkers = [`dead-${tag}`, `alive-${tag}`];

  const { missionTaskId } = await launchKernMission(session, { plan: buildNewProductMissionPlan("我想开发一个便携咖啡机"), conversationId: null, sourceRunId: `rec-${tag}` });
  const node = await prisma.agentTask.findFirstOrThrow({
    where: { organizationId: org.id, parentTaskId: missionTaskId, status: AgentTaskStatus.QUEUED, contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission-node/v1" } },
    orderBy: { createdAt: "asc" },
  });
  /** 模拟「领取 → 开始执行 → 进程崩溃」：任务停在 RUNNING，租约属于指定 owner。 */
  const crash = async (owner: string, opts: { claimedAgoMs?: number; expired?: boolean } = {}) => {
    const token = await claimAgentTaskForExecution(node.id, org.id);
    assert.ok(token, "能领取");
    await startAgentTask(worker, node.id);
    const claimedAt = new Date(Date.now() - (opts.claimedAgoMs ?? 120_000));
    const expiresAt = opts.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 600_000);
    await prisma.$executeRaw`UPDATE "AgentTask" SET "contextSnapshot" = jsonb_set("contextSnapshot", '{executorLease}', ${JSON.stringify({ token, owner, claimedAt, expiresAt })}::jsonb) WHERE id = ${node.id}`;
  };
  const snapOf = async () => (await prisma.agentTask.findUniqueOrThrow({ where: { id: node.id } }));

  try {
    console.log("▶ WR1 崩溃 → 自动重新排队；重复扫描幂等");
    await crash(fakeWorkers[0]);
    const rootBefore = (await prisma.agentTask.findUniqueOrThrow({ where: { id: missionTaskId } })).status;
    const r1 = await recoverOrphanedTasks({ organizationId: org.id });
    assert.deepEqual(r1.requeued, [node.id]);
    let t = await snapOf();
    assert.equal(t.status, AgentTaskStatus.QUEUED);
    const ctx = t.contextSnapshot as Record<string, { attempts?: number; lastOutcome?: string } | undefined>;
    assert.equal(ctx.executorLease, undefined, "租约已清除");
    assert.equal(ctx.executorState?.attempts, 1);
    assert.equal(ctx.executorState?.lastOutcome, "INTERRUPTED");
    assert.equal(await prisma.agentRun.count({ where: { agentTaskId: node.id, status: "RUNNING" } }), 0, "AgentRun 不再悬挂");
    assert.equal(await prisma.agentRun.count({ where: { agentTaskId: node.id, status: "FAILED" } }), 1);
    const r1b = await recoverOrphanedTasks({ organizationId: org.id });
    assert.equal(r1b.requeued.length + r1b.failed.length, 0, "重复扫描不再动它");
    assert.equal((await prisma.agentTask.findUniqueOrThrow({ where: { id: missionTaskId } })).status, rootBefore, "任务根不被误伤");

    console.log("▶ WR2 持有者活着 → 不动；失联后接管");
    await prisma.pmWorkerHeartbeat.create({ data: { workerId: fakeWorkers[1], pid: 1, host: "test", startedAt: new Date(), heartbeatAt: new Date() } });
    await crash(fakeWorkers[1], { expired: true });
    const r2 = await recoverOrphanedTasks({ organizationId: org.id });
    assert.equal(r2.requeued.length, 0, "慢任务不是死任务");
    assert.equal((await snapOf()).status, AgentTaskStatus.RUNNING);
    await prisma.pmWorkerHeartbeat.update({ where: { workerId: fakeWorkers[1] }, data: { heartbeatAt: new Date(Date.now() - 5 * 60_000) } });
    const r2b = await recoverOrphanedTasks({ organizationId: org.id });
    assert.deepEqual(r2b.requeued, [node.id]);
    assert.equal(((await snapOf()).contextSnapshot as { executorState: { attempts: number } }).executorState.attempts, 2);

    console.log("▶ WR3 重试用完 → FAILED");
    await crash(fakeWorkers[0]);
    const r3 = await recoverOrphanedTasks({ organizationId: org.id });
    assert.deepEqual(r3.failed, [node.id]);
    t = await snapOf();
    assert.equal(t.status, AgentTaskStatus.FAILED);

    console.log("▶ WR4 继续推进，任务得出结果");
    await drain(org.id);
    const st = await getKernMissionStatus(session, missionTaskId);
    assert.ok(st.outcome, "任务没有挂起，得出了结果");

    console.log("▶ WR5 心跳与健康");
    await runPmWorker({ once: true, ignoreLock: true, quiet: true, organizationId: org.id, loops: ["schedule"] });
    const mine = await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID } });
    assert.ok(mine.stoppedAt, "退出时标记停止");
    const health = await getWorkerHealth();
    assert.ok(["stopped", "stale", "running"].includes(health.status));
    assert.ok(health.heartbeatAt);

    console.log("\n✅ Kern worker recovery regression passed");
  } finally {
    setMissionModelInvokerForTest(null);
    await prisma.pmWorkerHeartbeat.deleteMany({ where: { workerId: { in: [...fakeWorkers, PROCESS_WORKER_ID] } } });
    await prisma.kernMissionEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
