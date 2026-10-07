/** Independent third review: valid small budgets, once stop, live drain ownership. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { workerHandlers } from "../src/modules/worker/registry";
import { executorLoopTick } from "../src/modules/worker/loops";
import { configureWorkBudget, drainInFlight, resetWorkBudgetForTest, trackInFlight } from "../src/modules/worker/scheduler";
import { resetFairQueueCursorsForTest } from "../src/modules/worker/fair-queue";
import { PROCESS_WORKER_ID } from "../src/modules/worker/heartbeat";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timeout: ${label}`);
}
async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const code = `r3-${tag}`;
  const orgIds: string[] = [];
  const controllers: AbortController[] = [];
  const workers: Promise<unknown>[] = [];
  const gates: ReturnType<typeof gate>[] = [];
  const handlers = workerHandlers();
  const originalStrategies = handlers.strategies;
  const originalSchemas = handlers.contextSchemaVersions;
  const originalTick = handlers.conversations!.runPendingTick;
  const originalTransaction = prisma.$transaction;
  const originalFind = prisma.agentTask.findUnique;
  const originalLockDir = process.env.PM_WORKER_LOCK_DIR;
  const lockDir = mkdtempSync(path.join(tmpdir(), "kern-r3-review-"));
  const failures: string[] = [];
  const served = new Set<string>();
  let refill = false;
  const record = (ok: boolean, check: string, detail: unknown) => {
    console.log(JSON.stringify({ check, result: ok ? "PASS" : "FAIL", detail }));
    if (!ok) failures.push(check);
  };
  async function createOrg(suffix: string) {
    const org = await prisma.organization.create({ data: { code: `r3-${tag}-${suffix}`, name: "Independent R3 acceptance" } });
    orgIds.push(org.id);
    const agent = await prisma.agent.create({ data: { organizationId: org.id, code, name: "Review probe", roleKey: "PM", accessMode: "ORGANIZATION" } });
    await prisma.agentTask.create({ data: { organizationId: org.id, agentId: agent.id, goal: "Stable fairness backlog" } });
    return { org, agent };
  }
  function startOnce(loop: "conversation" | "executor", organizationId: string) {
    const controller = new AbortController(); controllers.push(controller);
    const worker = runPmWorker({ once: true, loops: [loop], organizationId, ignoreLock: true, quiet: true, signal: controller.signal });
    workers.push(worker.catch(() => undefined));
    return { controller, worker };
  }
  handlers.contextSchemaVersions = [];
  handlers.strategies = { [code]: async context => {
    served.add(context.task.organizationId);
    if (refill) {
      const agent = await prisma.agent.findFirstOrThrow({ where: { organizationId: context.task.organizationId, code } });
      await prisma.agentTask.create({ data: { organizationId: context.task.organizationId, agentId: agent.id, goal: "Stable fairness backlog" } });
    }
    return { kind: "SUCCEEDED", summary: "Independent review", result: {} };
  } };
  try {
    const bulk: string[] = [];
    for (let i = 0; i < 80; i++) bulk.push((await createOrg(`bulk-${i}`)).org.id);
    refill = true;
    for (const config of [{ total: 1, batch: 2 }, { total: 2, batch: 1 }]) {
      served.clear(); resetFairQueueCursorsForTest();
      configureWorkBudget({ total: config.total, perOrganization: 1 });
      for (let tick = 0; tick < 240; tick++) {
        await executorLoopTick({ limit: config.batch });
        await drainInFlight();
      }
      record(served.size === bulk.length, `80 stable orgs: total=${config.total} batch=${config.batch}`, { ticks: 240, organizations: bulk.length, actuallyStarted: served.size, neverStarted: bulk.filter(id => !served.has(id)).length });
    }
    refill = false;
    await prisma.agentTask.updateMany({ where: { organizationId: { in: bulk }, status: "QUEUED" }, data: { status: "CANCELLED" } });
    const small: string[] = [];
    for (let i = 0; i < 3; i++) small.push((await createOrg(`small-${i}`)).org.id);
    refill = true; served.clear(); resetFairQueueCursorsForTest();
    configureWorkBudget({ total: 1, perOrganization: 1 });
    for (let tick = 0; tick < 30; tick++) {
      await executorLoopTick({ limit: 1 }); await drainInFlight();
    }
    record(served.size === small.length, "3 stable orgs: total=1 batch=1", { ticks: 30, organizations: small.length, actuallyStarted: served.size });
    refill = false;
    await prisma.agentTask.updateMany({ where: { organizationId: { in: small }, status: "QUEUED" }, data: { status: "CANCELLED" } });

    const once = await createOrg("once");
    const task = await prisma.agentTask.findFirstOrThrow({ where: { organizationId: once.org.id, status: "QUEUED" } });
    const taskResume = gate(); gates.push(taskResume);
    let taskHeld = false;
    prisma.agentTask.findUnique = (async (...args: Parameters<typeof originalFind>) => {
      const result = await Reflect.apply(originalFind, prisma.agentTask, args);
      if (!taskHeld && args[0].where.id === task.id && args[0].include?.parentTask) {
        taskHeld = true; await taskResume.promise;
      }
      return result;
    }) as unknown as typeof originalFind;
    const taskWorker = startOnce("executor", once.org.id);
    await waitFor(async () => taskHeld, "once executor preclaim read");
    taskWorker.controller.abort();
    assert.equal((await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } })).status, "QUEUED");
    taskResume.release(); await taskWorker.worker;
    prisma.agentTask.findUnique = originalFind;
    const taskAfter = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id }, select: { status: true, startedAt: true } });
    record(taskAfter.status === "QUEUED" && taskAfter.startedAt === null, "once executor stops before ownership claim", taskAfter);

    const user = await prisma.user.create({ data: { organizationId: once.org.id, email: `${tag}@r3.kern.test`, name: "Owner", orgMemberships: { create: { organizationId: once.org.id, role: "ORG_ADMIN" } } } });
    const conversation = await prisma.conversation.create({ data: { organizationId: once.org.id, ownerId: user.id, title: "Once stop boundary" } });
    const input = await prisma.message.create({ data: { conversationId: conversation.id, role: "USER", content: "查询公司知识库，不创建任务。" } });
    const run = await prisma.agentRun.create({ data: { organizationId: once.org.id, userId: user.id, conversationId: conversation.id, inputMessageId: input.id, clientMessageId: randomUUID(), goal: input.content } });
    const messageResume = gate(); gates.push(messageResume);
    let messageHeld = false;
    prisma.$transaction = ((callback: unknown, options: unknown) => {
      if (typeof callback !== "function") return Reflect.apply(originalTransaction, prisma, [callback, options]);
      const wrap = (tx: Prisma.TransactionClient) => callback(new Proxy(tx, { get(target, key) {
        if (key !== "agentRun") return Reflect.get(target, key);
        return new Proxy(target.agentRun, { get(model, method) {
          if (method !== "findUnique") return Reflect.get(model, method);
          return async (args: { where?: { id?: string }; select?: { conversationId?: boolean } }) => {
            const result = await model.findUnique(args as Prisma.AgentRunFindUniqueArgs);
            if (!messageHeld && args.where?.id === run.id && args.select?.conversationId) {
              messageHeld = true; await messageResume.promise;
            }
            return result;
          };
        } });
      } }));
      return Reflect.apply(originalTransaction, prisma, [wrap, options]);
    }) as typeof originalTransaction;
    const messageWorker = startOnce("conversation", once.org.id);
    await waitFor(async () => messageHeld, "once message preclaim read");
    messageWorker.controller.abort();
    assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status, "QUEUED");
    messageResume.release(); await messageWorker.worker;
    prisma.$transaction = originalTransaction;
    const messageAfter = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, startedAt: true } });
    record(messageAfter.status === "QUEUED" && messageAfter.startedAt === null, "once message stops before ownership claim", messageAfter);

    // Real owner alive with tracked work; simulate only age in its own temporary lock.
    process.env.PM_WORKER_LOCK_DIR = lockDir;
    const pending = gate(); gates.push(pending);
    let polling = false;
    handlers.conversations!.runPendingTick = async () => {
      if (!polling) { polling = true; trackInFlight(pending.promise); }
      return { scanned: 0, acted: 0, skipped: 0, errors: 0 };
    };
    const ownerController = new AbortController(); controllers.push(ownerController);
    const owner = runPmWorker({ loops: ["conversation"], organizationId: once.org.id, quiet: true, signal: ownerController.signal });
    workers.push(owner.catch(() => undefined));
    const lockFile = path.join(lockDir, "lock.json");
    await waitFor(async () => polling && existsSync(lockFile), "real owner lock and tracked work");
    ownerController.abort();
    await new Promise(resolve => setTimeout(resolve, 250));
    const state = JSON.parse(readFileSync(lockFile, "utf8"));
    state.heartbeatAt = new Date(Date.now() - 16 * 60000).toISOString();
    writeFileSync(lockFile, JSON.stringify(state));
    const contender = spawnSync(process.execPath, ["--import", "tsx", "-e", "import { acquireWorkerLock } from './src/modules/worker/index'; console.log(acquireWorkerLock() ? 'ACQUIRED' : 'REFUSED')"], { env: { ...process.env, PM_WORKER_LOCK_DIR: lockDir }, encoding: "utf8", timeout: 15000 });
    assert.equal(contender.status, 0, contender.stderr || "contender failed");
    record(contender.stdout.includes("REFUSED"), "live draining owner with stale file heartbeat refuses contender", { ownerPid: process.pid, heartbeatAgeMinutes: 16, simulatedAge: true, contender: contender.stdout.trim() });
    pending.release(); await owner;
    console.log(JSON.stringify({ summary: "R3 boundaries", failures }));
    if (failures.length) process.exitCode = 1;
  } finally {
    refill = false;
    controllers.forEach(controller => controller.abort()); gates.forEach(g => g.release());
    await Promise.allSettled(workers); await drainInFlight();
    prisma.$transaction = originalTransaction; prisma.agentTask.findUnique = originalFind;
    handlers.strategies = originalStrategies; handlers.contextSchemaVersions = originalSchemas; handlers.conversations!.runPendingTick = originalTick;
    if (originalLockDir === undefined) delete process.env.PM_WORKER_LOCK_DIR; else process.env.PM_WORKER_LOCK_DIR = originalLockDir;
    rmSync(lockDir, { recursive: true, force: true });
    const users = await prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.pmWorkerHeartbeat.deleteMany({ where: { workerId: PROCESS_WORKER_ID } });
    resetWorkBudgetForTest(); resetFairQueueCursorsForTest();
    console.log("R3 review fixture cleanup complete.");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
