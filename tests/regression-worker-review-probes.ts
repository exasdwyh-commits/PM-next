/** Independent TASK-011 acceptance counterexamples. Red means delivery needs repair. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { workerHandlers } from "../src/modules/worker/registry";
import { discoverExecutorCandidates, discoverMessageCandidates, resetFairQueueCursorsForTest } from "../src/modules/worker/fair-queue";
import { configureWorkBudget, drainInFlight, inFlightCount, resetWorkBudgetForTest, trackInFlight } from "../src/modules/worker/scheduler";
import { executorLoopTick } from "../src/modules/worker/loops";
import { runPendingKernMessagesTick } from "../src/modules/assistant-runtime/message-worker";
import { PROCESS_WORKER_ID } from "../src/modules/worker/heartbeat";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const orgIds: string[] = [];
  const code = `review-${tag}`;
  const handlers = workerHandlers();
  const originalStrategies = handlers.strategies;
  const originalSchemas = handlers.contextSchemaVersions;
  const originalTick = handlers.conversations!.runPendingTick;
  const groupBy = prisma.agentRun.groupBy.bind(prisma.agentRun);
  const originalGroupBy = prisma.agentRun.groupBy;
  const originalLockDir = process.env.PM_WORKER_LOCK_DIR;
  const lockDir = mkdtempSync(path.join(tmpdir(), "kern-task011-review-"));
  const controllers: AbortController[] = [];
  const workers: Promise<unknown>[] = [];
  const gates: ReturnType<typeof gate>[] = [];
  const failures: string[] = [];
  const check = (ok: boolean, message: string, detail: unknown) => {
    console.log(JSON.stringify({ check: message, result: ok ? "PASS" : "FAIL", detail }));
    if (!ok) failures.push(message);
  };
  // This two-org boundary must exclude unrelated eligible strategies in the shared test DB.
  handlers.contextSchemaVersions = [];
  handlers.strategies = { [code]: async () => ({ kind: "SUCCEEDED", summary: "review fixture", result: {} }) };
  try {
    // Keep all earlier orgs queued: their backlog must not hide org 21 indefinitely.
    for (let i = 0; i < 21; i++) {
      const org = await prisma.organization.create({ data: { code: `rv-${tag.slice(0, 8)}-${i}`, name: "TASK011 independent review fixture" } });
      orgIds.push(org.id);
      const user = await prisma.user.create({ data: { organizationId: org.id, name: "Review fixture", email: `${tag}-${i}@review.kern.test`, orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
      const agent = await prisma.agent.create({ data: { organizationId: org.id, code, name: "Review fixture", roleKey: "PM", accessMode: "ORGANIZATION" } });
      const createdAt = new Date(Date.UTC(2000, 0, 1, 0, 0, i));
      await prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, goal: "Review fixture", createdAt } });
      const conversation = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "Review fixture" } });
      const input = await prisma.message.create({ data: { conversationId: conversation.id, role: "USER", content: "查询公司知识库，不要创建任务或执行写操作。" } });
      await prisma.agentRun.create({ data: { organizationId: org.id, userId: user.id, conversationId: conversation.id, inputMessageId: input.id, clientMessageId: randomUUID(), goal: input.content, createdAt } });
    }
    resetFairQueueCursorsForTest();
    const executorSeen = new Set<string>();
    const messageSeen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      for (const item of await discoverExecutorCandidates(8)) executorSeen.add(item.organizationId);
      for (const item of await discoverMessageCandidates(8)) messageSeen.add(item.organizationId);
    }
    check(executorSeen.has(orgIds[20]), "21st organization eventually discovered: executor", { rounds: 25, discoveredFixtureOrgs: orgIds.filter(id => executorSeen.has(id)).length });
    check(messageSeen.has(orgIds[20]), "21st organization eventually discovered: conversation", { rounds: 25, discoveredFixtureOrgs: orgIds.filter(id => messageSeen.has(id)).length });

    // Leave just A/B as the oldest candidates; A's org slot is busy, total still has room.
    await prisma.agentTask.updateMany({ where: { organizationId: { in: orgIds.slice(2) } }, data: { status: "CANCELLED" } });
    await prisma.agentRun.updateMany({ where: { organizationId: { in: orgIds.slice(2) } }, data: { status: "FAILED" } });
    for (const queue of ["executor", "conversation"] as const) {
      resetFairQueueCursorsForTest();
      const budget = configureWorkBudget({ total: 2, perOrganization: 1 });
      const releaseA = budget.tryAcquire(orgIds[0])!;
      const result = queue === "executor" ? await executorLoopTick({ limit: 2 }) : await runPendingKernMessagesTick({ limit: 2 });
      releaseA();
      await drainInFlight();
      const bStarted = queue === "executor"
        ? await prisma.agentTask.count({ where: { organizationId: orgIds[1], startedAt: { not: null } } })
        : await prisma.agentRun.count({ where: { organizationId: orgIds[1], clientMessageId: { not: null }, startedAt: { not: null } } });
      check(bStarted > 0, `skip saturated A and admit eligible B: ${queue}`, { acted: result.acted, bStarted, notes: result.notes });
    }

    // Hold actual message discovery across abort, then observe the real persisted claim.
    await prisma.agentRun.updateMany({ where: { organizationId: { in: orgIds } }, data: { status: "FAILED" } });
    const orgId = orgIds[0];
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, isSystem: false } });
    const conversation = await prisma.conversation.create({ data: { organizationId: orgId, ownerId: user.id, kind: "ADVISOR", title: "Review stop boundary" } });
    const input = await prisma.message.create({ data: { conversationId: conversation.id, role: "USER", content: "查询公司知识库，不要创建任务或执行写操作。" } });
    const run = await prisma.agentRun.create({ data: { organizationId: orgId, userId: user.id, conversationId: conversation.id, inputMessageId: input.id, clientMessageId: randomUUID(), goal: input.content } });
    const entered = gate();
    const resume = gate();
    gates.push(entered, resume);
    prisma.agentRun.groupBy = (async (...args: Parameters<typeof groupBy>) => {
      const result = await groupBy(...args);
      entered.release();
      await resume.promise;
      return result;
    }) as unknown as typeof originalGroupBy;
    const controller = new AbortController();
    controllers.push(controller);
    const worker = runPmWorker({ loops: ["conversation"], ignoreLock: true, quiet: true, organizationId: orgId, signal: controller.signal });
    workers.push(worker);
    await entered.promise;
    controller.abort();
    assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status, "QUEUED", "must still be unclaimed at abort");
    resume.release();
    await worker;
    prisma.agentRun.groupBy = originalGroupBy;
    const afterStop = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, startedAt: true } });
    check(afterStop.status === "QUEUED" && afterStop.startedAt === null, "abort closes admission before delayed discovery returns", afterStop);

    // Inject a real filesystem heartbeat failure while production scheduler owns live work.
    const faultGate = gate();
    const faultEntered = gate();
    gates.push(faultGate, faultEntered);
    process.env.PM_WORKER_LOCK_DIR = lockDir;
    handlers.conversations!.runPendingTick = async () => {
      trackInFlight(faultGate.promise);
      mkdirSync(path.join(lockDir, `lock.json.${process.pid}.tmp`));
      faultEntered.release();
      return { scanned: 1, acted: 1, skipped: 0, errors: 0 };
    };
    const faultWorker = runPmWorker({ loops: ["conversation"], quiet: true, maxTicks: 1 });
    let errorCode: string | undefined;
    const faultSettled = faultWorker.catch(error => { errorCode = (error as NodeJS.ErrnoException).code; });
    workers.push(faultSettled);
    await faultEntered.promise;
    // A corrected implementation waits for the gate; never await it before release.
    await Promise.race([faultSettled, new Promise(resolve => setTimeout(resolve, 250))]);
    const beat = await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID } });
    const liveWork = inFlightCount();
    check(liveWork === 0 || (!beat.stoppedAt && existsSync(path.join(lockDir, "lock.json"))), "file-heartbeat failure drains before releasing ownership", { errorCode, trackedInFlight: liveWork, markedStopped: !!beat.stoppedAt, lockExists: existsSync(path.join(lockDir, "lock.json")) });
    faultGate.release();
    await faultSettled;
    await drainInFlight();
    console.log(JSON.stringify({ summary: "independent acceptance counterexamples", failures }));
    if (failures.length) process.exitCode = 1;
  } finally {
    for (const controller of controllers) controller.abort();
    for (const g of gates) g.release();
    await Promise.allSettled(workers);
    await drainInFlight();
    prisma.agentRun.groupBy = originalGroupBy;
    handlers.conversations!.runPendingTick = originalTick;
    handlers.strategies = originalStrategies;
    handlers.contextSchemaVersions = originalSchemas;
    if (originalLockDir === undefined) delete process.env.PM_WORKER_LOCK_DIR;
    else process.env.PM_WORKER_LOCK_DIR = originalLockDir;
    rmSync(lockDir, { recursive: true, force: true });
    const users = await prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.pmWorkerHeartbeat.deleteMany({ where: { workerId: PROCESS_WORKER_ID } });
    resetWorkBudgetForTest();
    resetFairQueueCursorsForTest();
    console.log("Review fixtures cleaned: only organizations created by this probe run.");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
