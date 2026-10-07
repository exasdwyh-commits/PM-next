/** Independent R2 acceptance: actual claim boundary, served fairness, failed heartbeat. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { workerHandlers } from "../src/modules/worker/registry";
import { configureWorkBudget, drainInFlight, resetWorkBudgetForTest, trackInFlight } from "../src/modules/worker/scheduler";
import { resetFairQueueCursorsForTest } from "../src/modules/worker/fair-queue";
import { executorLoopTick } from "../src/modules/worker/loops";
import { PROCESS_WORKER_ID } from "../src/modules/worker/heartbeat";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function waitFor(check: () => Promise<boolean>, label: string, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timeout: ${label}`);
}
async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const orgIds: string[] = [];
  const handlers = workerHandlers();
  const strategies = handlers.strategies;
  const schemas = handlers.contextSchemaVersions;
  const conversationTick = handlers.conversations!.runPendingTick;
  const originalTransaction = prisma.$transaction;
  const originalTaskFindUnique = prisma.agentTask.findUnique;
  const originalLockDir = process.env.PM_WORKER_LOCK_DIR;
  const originalConsoleError = console.error;
  const lockDir = mkdtempSync(path.join(tmpdir(), "kern-r2-boundaries-"));
  const controllers: AbortController[] = [];
  const workers: Promise<unknown>[] = [];
  const gates: ReturnType<typeof gate>[] = [];
  const failures: string[] = [];
  const record = (ok: boolean, name: string, detail: unknown) => {
    console.log(JSON.stringify({ check: name, result: ok ? "PASS" : "FAIL", detail }));
    if (!ok) failures.push(name);
  };
  const start = (loops: ["conversation"] | ["executor"], organizationId: string, quiet = true) => {
    const controller = new AbortController();
    controllers.push(controller);
    const worker = runPmWorker({ loops, organizationId, ignoreLock: true, quiet, signal: controller.signal });
    workers.push(worker.catch(() => undefined));
    return { controller, worker };
  };
  const code = `r2-${tag}`;
  const served = new Map<string, number>();
  let refill = false;
  handlers.contextSchemaVersions = [];
  handlers.strategies = { [code]: async context => {
    served.set(context.task.organizationId, (served.get(context.task.organizationId) ?? 0) + 1);
    if (refill) {
      const agent = await prisma.agent.findFirstOrThrow({ where: { organizationId: context.task.organizationId, code } });
      await prisma.agentTask.create({ data: { organizationId: context.task.organizationId, agentId: agent.id, goal: "Persistent fairness backlog" } });
    }
    return { kind: "SUCCEEDED", summary: "Independent review fixture", result: {} };
  } };
  try {
    const org = await prisma.organization.create({ data: { code: `r2-${tag}`, name: "R2 independent acceptance" } });
    orgIds.push(org.id);
    const user = await prisma.user.create({ data: { organizationId: org.id, email: `${tag}@r2.kern.test`, name: "Owner", orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } } } });
    const agent = await prisma.agent.create({ data: { organizationId: org.id, code, name: "Probe", roleKey: "PM", accessMode: "ORGANIZATION" } });
    const conversation = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: "Claim boundary" } });
    const input = await prisma.message.create({ data: { conversationId: conversation.id, role: "USER", content: "查询公司知识库，不创建任务。" } });
    const run = await prisma.agentRun.create({ data: { organizationId: org.id, userId: user.id, conversationId: conversation.id, inputMessageId: input.id, clientMessageId: randomUUID(), goal: input.content } });

    // Admission passed; hold the first read INSIDE the real transaction, before claim.
    const messageEntered = gate();
    const messageResume = gate();
    gates.push(messageEntered, messageResume);
    let held = false;
    prisma.$transaction = ((callback: unknown, options: unknown) => {
      if (typeof callback !== "function") return Reflect.apply(originalTransaction, prisma, [callback, options]);
      const wrap = (tx: Prisma.TransactionClient) => callback(new Proxy(tx, { get(target, key) {
        if (key !== "agentRun") return Reflect.get(target, key);
        return new Proxy(target.agentRun, { get(model, method) {
          if (method !== "findUnique") return Reflect.get(model, method);
          return async (args: { where?: { id?: string }; select?: { conversationId?: boolean } }) => {
            const result = await model.findUnique(args as Prisma.AgentRunFindUniqueArgs);
            if (!held && args.where?.id === run.id && args.select?.conversationId) {
              held = true; messageEntered.release(); await messageResume.promise;
            }
            return result;
          };
        } });
      } }));
      return Reflect.apply(originalTransaction, prisma, [wrap, options]);
    }) as typeof originalTransaction;
    const messageWorker = start(["conversation"], org.id);
    await waitFor(async () => held, "message transaction first read");
    messageWorker.controller.abort();
    assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status, "QUEUED");
    messageResume.release();
    await messageWorker.worker;
    prisma.$transaction = originalTransaction;
    const messageAfter = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, startedAt: true } });
    record(messageAfter.status === "QUEUED" && messageAfter.startedAt === null, "stop inside message claim before any ownership write", messageAfter);

    // Admission passed; hold task read INSIDE executeAgentTask, before the lease CAS.
    const task = await prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, goal: "Executor claim boundary" } });
    const taskEntered = gate();
    const taskResume = gate();
    gates.push(taskEntered, taskResume);
    let taskHeld = false;
    prisma.agentTask.findUnique = (async (...args: Parameters<typeof originalTaskFindUnique>) => {
      const result = await Reflect.apply(originalTaskFindUnique, prisma.agentTask, args);
      if (!taskHeld && args[0].where.id === task.id && args[0].include?.parentTask) {
        taskHeld = true; taskEntered.release(); await taskResume.promise;
      }
      return result;
    }) as unknown as typeof originalTaskFindUnique;
    const taskWorker = start(["executor"], org.id);
    await waitFor(async () => taskHeld, "executor internal task read");
    taskWorker.controller.abort();
    assert.equal((await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } })).status, "QUEUED");
    taskResume.release();
    await taskWorker.worker;
    prisma.agentTask.findUnique = originalTaskFindUnique;
    const taskAfter = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id }, select: { status: true, startedAt: true } });
    record(taskAfter.status === "QUEUED" && taskAfter.startedAt === null, "stop inside executor before lease claim", taskAfter);

    // Stable 80 eligible orgs; actual fast execution replenishes its own queue.
    await prisma.agentTask.updateMany({ where: { organizationId: org.id, status: "QUEUED" }, data: { status: "CANCELLED" } });
    served.clear(); refill = true;
    const fairnessOrgs: string[] = [];
    for (let i = 0; i < 80; i++) {
      const bulk = await prisma.organization.create({ data: { code: `r2bulk-${tag}-${i}`, name: "Stable fairness backlog" } });
      orgIds.push(bulk.id); fairnessOrgs.push(bulk.id);
      const bulkAgent = await prisma.agent.create({ data: { organizationId: bulk.id, code, name: "Fairness probe", roleKey: "PM", accessMode: "ORGANIZATION" } });
      await prisma.agentTask.create({ data: { organizationId: bulk.id, agentId: bulkAgent.id, goal: "Persistent fairness backlog" } });
    }
    resetFairQueueCursorsForTest();
    configureWorkBudget({ total: 2, perOrganization: 1 });
    for (let tick = 0; tick < 120; tick++) {
      await executorLoopTick({ limit: 2 });
      await drainInFlight();
    }
    const neverServed = fairnessOrgs.filter(id => !served.has(id));
    record(neverServed.length === 0, "80 stable orgs: actual execution coverage with default budget/batch", { ticks: 120, organizations: 80, actuallyStarted: fairnessOrgs.length - neverServed.length, neverStarted: neverServed.length });
    refill = false;

    // Timer failure must close admission; merely holding the file lock briefly is insufficient.
    const heartbeatGate = gate(); gates.push(heartbeatGate);
    process.env.PM_WORKER_LOCK_DIR = lockDir;
    let launches = 0;
    let observedFailure = false;
    console.error = (...args: unknown[]) => {
      if (args.some(arg => String(arg).includes("[pm-worker] 心跳失败"))) observedFailure = true;
      originalConsoleError(...args);
    };
    handlers.conversations!.runPendingTick = async () => {
      launches += 1;
      if (launches === 1) {
        trackInFlight(heartbeatGate.promise);
        mkdirSync(path.join(lockDir, `lock.json.${process.pid}.tmp`));
      }
      return { scanned: 0, acted: 0, skipped: 0, errors: 0 };
    };
    const heartbeatController = new AbortController(); controllers.push(heartbeatController);
    const heartbeatWorker = runPmWorker({ loops: ["conversation"], organizationId: org.id, intervals: { conversation: 200 }, signal: heartbeatController.signal });
    workers.push(heartbeatWorker.catch(() => undefined));
    await waitFor(async () => observedFailure, "actual heartbeat timer EISDIR", 15000);
    const before = launches;
    await new Promise(resolve => setTimeout(resolve, 700));
    record(launches === before, "file heartbeat failure closes admission and stops polling", { launchesAtFailure: before, launchesLater: launches, lockExists: existsSync(path.join(lockDir, "lock.json")) });
    heartbeatController.abort(); heartbeatGate.release();
    await heartbeatWorker.catch(() => undefined);
    console.log(JSON.stringify({ summary: "R2 deeper boundaries", failures }));
    if (failures.length) process.exitCode = 1;
  } finally {
    for (const controller of controllers) controller.abort();
    for (const g of gates) g.release();
    await Promise.allSettled(workers);
    await drainInFlight();
    prisma.$transaction = originalTransaction;
    prisma.agentTask.findUnique = originalTaskFindUnique;
    console.error = originalConsoleError;
    handlers.strategies = strategies;
    handlers.contextSchemaVersions = schemas;
    handlers.conversations!.runPendingTick = conversationTick;
    if (originalLockDir === undefined) delete process.env.PM_WORKER_LOCK_DIR;
    else process.env.PM_WORKER_LOCK_DIR = originalLockDir;
    rmSync(lockDir, { recursive: true, force: true });
    const users = await prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.pmWorkerHeartbeat.deleteMany({ where: { workerId: PROCESS_WORKER_ID } });
    resetWorkBudgetForTest(); resetFairQueueCursorsForTest();
    console.log("R2 review fixture cleanup complete.");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
