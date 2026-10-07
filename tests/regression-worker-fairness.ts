import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { workerHandlers } from "../src/modules/worker/registry";
import {
  configureWorkBudget,
  drainInFlight,
  getWorkBudget,
  inFlightCount,
  resetWorkBudgetForTest,
  resolveWorkLimits,
  type WorkBudget,
} from "../src/modules/worker/scheduler";
import { executorLoopTick } from "../src/modules/worker/loops";
import { discoverExecutorCandidates, discoverMessageCandidates, resetFairQueueCursorsForTest } from "../src/modules/worker/fair-queue";
import { createKernConversation } from "../src/modules/assistant-runtime/conversations";
import { acceptKernMessage } from "../src/modules/assistant-runtime/message-intake";
import { runPendingKernMessagesTick } from "../src/modules/assistant-runtime/message-worker";
import { DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG } from "../src/modules/assistant-runtime/conversation-config";
import { cancelInteractiveRun } from "../src/modules/advisor/runs";
import { PROCESS_WORKER_ID } from "../src/modules/worker/heartbeat";
import { executePersistedModelGateway, type ModelPolicy, type ModelProfile } from "../src/modules/model-gateway";
import type { ExecutorOutcome, ExecutorStrategy } from "../src/modules/worker/executor";
import type { SessionContext } from "@/modules/identity/session";

/**
 * TASK-011：并发与组织公平调度回归。
 *
 * 回归目标（改动前的真实缺陷）：
 *   - 常驻 Worker 外层逐个 await：组织 A 的慢模型会把 executor / conversation 循环一起冻住，
 *     组织 B 的会话和任务推不动；
 *   - 两条队列各自吃满 limit，真实总并发翻倍；
 *   - 候选按全局前 N 条取，A 的旧积压可以把 B 完全挤出候选窗口，长期饿死。
 *
 * 同步屏障：模型 HTTP 用本地回环夹具 + 每场景独立的「进入 / 释放」门，
 * 不用随机 sleep 判定先后；时间顺序与在途峰值都打印出来。
 */

const PROVIDER = "fairfixture";
const PROVIDER_ENV = "MODEL_PROVIDER_FAIRFIXTURE_BASE_URL";

const tag = process.env.T011_RUN_TAG ?? randomUUID();

/** 每个「慢」模型一个门：entered 在请求进入夹具时 resolve，release 之后才回响应。 */
class Gate {
  private open!: () => void;
  private arrivals: string[] = [];
  private enteredResolve!: () => void;
  readonly entered = new Promise<void>((resolve) => {
    this.enteredResolve = resolve;
  });
  readonly released = new Promise<void>((resolve) => {
    this.open = resolve;
  });
  closedBeforeRelease = 0;
  private closed = false;

  noteClosed() {
    this.closed = true;
  }
  noteArrival(model: string) {
    this.arrivals.push(model);
    this.enteredResolve();
  }
  release() {
    this.open();
  }
  count() {
    return this.arrivals.length;
  }
  resetClosed() {
    this.closed = false;
  }
  get wasClosed() {
    return this.closed;
  }
}

const gates = new Map<string, Gate>();
function gate(model: string): Gate {
  let g = gates.get(model);
  if (!g) {
    g = new Gate();
    gates.set(model, g);
  }
  return g;
}

const fastCalls: string[] = [];

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk: Buffer) => {
    raw += chunk;
  });
  req.on("end", () => {
    let model = "";
    try {
      model = String(JSON.parse(raw).model ?? "");
    } catch {
      model = "";
    }
    const slow = gates.get(model);
    if (slow) {
      slow.noteArrival(model);
      res.on("close", () => slow.noteClosed());
      void slow.released.then(() => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: `answer(${model})` } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      });
      return;
    }
    fastCalls.push(model);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: `answer(${model})` } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});

/** 组织 → executor 探针要用的模型名。 */
const probeModel = new Map<string, string>();
let probeConcurrency = 0;
let probePeak = 0;
const probeOrder: string[] = [];

function probeStrategy(model: string): ExecutorStrategy {
  return async (context) => {
    probeConcurrency += 1;
    probePeak = Math.max(probePeak, probeConcurrency);
    probeOrder.push(`${context.task.id}:start:${model}`);
    try {
      const profile: ModelProfile = {
        id: `${model}-profile`,
        provider: PROVIDER,
        modelId: model,
        displayName: model,
        enabled: true,
        capabilities: ["TEXT"],
        locality: "LOCAL",
        health: "HEALTHY",
        qualityTier: "FAST",
        latencyTier: "FAST",
        costTier: "FREE",
      };
      const policy: ModelPolicy = {
        id: `probe-${model}`,
        version: "1",
        taskClass: "QUICK_RESEARCH",
        candidates: [{ profileId: profile.id, priority: 1 }],
        requiredCapabilities: ["TEXT"],
        cloudAllowed: false,
        failurePolicy: { failureThreshold: 1, cooldownMs: 60_000 },
      };
      await executePersistedModelGateway({
        organizationId: context.task.organizationId,
        policy,
        profiles: [profile],
        request: {
          signal: context.signal,
          taskClass: policy.taskClass,
          messages: [{ role: "user", content: "probe" }],
        },
      });
      const outcome: ExecutorOutcome = { kind: "SUCCEEDED", summary: `probe ${model}`, result: { model } };
      return outcome;
    } finally {
      probeConcurrency -= 1;
    }
  };
}

const registry = workerHandlers();
const probeCode = "t011_probe";

/**
 * R5：任何常驻 Worker 都必须登记在这里，由最外层 finally 统一 abort + await。
 * 否则断言中途失败会把无限轮询的 Worker 留在后台，继续执行后续测试创建的组织任务
 * （上一轮验收实测残留过 5 个孤儿进程）。
 */
type PmWorkerOptionsLike = NonNullable<Parameters<typeof runPmWorker>[0]>;

const liveWorkers = new Set<Promise<unknown>>();
const liveControllers = new Set<AbortController>();
/** 需要在 finally 里恢复的临时目录与环境（R5：不能只在断言成功后清理）。 */
const tempResources: Array<() => void> = [];

function startWorker(options: PmWorkerOptionsLike): Promise<unknown> {
  // 每个 Worker 都必须能被外层 abort：否则断言中途失败就会留下无限轮询的孤儿进程。
  let controller = options.signal ? null : new AbortController();
  if (controller) liveControllers.add(controller);
  const promise = runPmWorker({ ...options, signal: options.signal ?? controller!.signal });
  liveWorkers.add(promise);
  promise.catch(() => undefined).finally(() => {
    liveWorkers.delete(promise);
    if (controller) liveControllers.delete(controller);
  });
  return promise;
}

/**
 * 取本次运行使用的锁目录，并在 finally 里恢复环境。
 *
 * 若外部（失败清理回归）已经指定了 `PM_WORKER_LOCK_DIR`，就直接用它 ——
 * **不新建、不删除**。否则父进程清理完子进程后再去检查那个目录，
 * 「无残留 lock.json」就又变成一句空断言：目录被整个删掉，锁释放与否都看不出来。
 */
function acquireTempLockDir(): string {
  const existing = process.env.PM_WORKER_LOCK_DIR;
  if (existing) {
    const previous = existing;
    tempResources.push(() => {
      process.env.PM_WORKER_LOCK_DIR = previous;
    });
    return existing;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "kern-t011-lock-"));
  const previous = process.env.PM_WORKER_LOCK_DIR;
  process.env.PM_WORKER_LOCK_DIR = dir;
  tempResources.push(() => {
    if (previous === undefined) delete process.env.PM_WORKER_LOCK_DIR;
    else process.env.PM_WORKER_LOCK_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
registry.strategies[probeCode] = async (context) =>
  probeStrategy(probeModel.get(context.task.organizationId) ?? "fast-probe")(context);

/** 本测试创建过的组织；场景之间清掉遗留的 QUEUED 工作，避免互相挤占候选窗口。 */
const createdOrgs: string[] = [];

/** 按外键顺序删除本次创建的夹具（只限 createdOrgs 里的 id）。 */
async function cleanupFixtures(): Promise<void> {
  if (createdOrgs.length === 0) return;
  const users = await prisma.user.findMany({ where: { organizationId: { in: createdOrgs } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.message.deleteMany({ where: { conversation: { organizationId: { in: createdOrgs } } } });
  await prisma.agentRun.deleteMany({ where: { organizationId: { in: createdOrgs } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgs } } });
  await prisma.agentTask.deleteMany({ where: { organizationId: { in: createdOrgs } } });
  await prisma.agent.deleteMany({ where: { organizationId: { in: createdOrgs } } });
  await prisma.modelProfileConfig.deleteMany({ where: { organizationId: { in: createdOrgs } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: createdOrgs } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  console.log(`清理完成：删除本次创建的 ${createdOrgs.length} 个组织及其夹具`);
}

async function quiesce(keepOrgs: string[] = []): Promise<void> {
  // 清掉上一场景的遗留工作后，服务游标也必须回到起点：
  // 否则它仍指向上一个场景的组织键，新场景的候选会被键集过滤跳过。
  resetFairQueueCursorsForTest();
  const stale = createdOrgs.filter((id) => !keepOrgs.includes(id));
  if (stale.length === 0) return;
  await prisma.agentRun.deleteMany({ where: { organizationId: { in: stale }, status: "QUEUED" } });
  await prisma.agentTask.deleteMany({ where: { organizationId: { in: stale }, status: "QUEUED" } });
}

async function makeOrg(name: string): Promise<{ orgId: string; userId: string; session: SessionContext }> {
  const org = await prisma.organization.create({ data: { code: `${name}_${tag}`.slice(0, 40), name } });
  createdOrgs.push(org.id);
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: `${name} owner`,
      email: `${name.toLowerCase()}-${tag}@kern.test`,
      orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } },
    },
  });
  return {
    orgId: org.id,
    userId: user.id,
    session: { userId: user.id, organizationId: org.id, userEmail: user.email, userName: user.name },
  };
}

async function makeProfile(orgId: string, model: string): Promise<void> {
  await prisma.modelProfileConfig.create({
    data: {
      organizationId: orgId,
      key: "t011-fixture",
      displayName: "TASK-011 fixture",
      provider: PROVIDER,
      modelId: model,
      capabilities: ["TEXT"],
      locality: "LOCAL",
      enabled: true,
      qualityTier: "FAST",
      latencyTier: "FAST",
      costTier: "FREE",
    },
  });
}

async function makeAgent(orgId: string, maxConcurrentTasks: number) {
  return prisma.agent.create({
    data: {
      organizationId: orgId,
      code: probeCode,
      name: "TASK-011 probe",
      roleKey: "PM",
      accessMode: "ORGANIZATION",
      maxConcurrentTasks,
    },
  });
}

async function makeTask(orgId: string, agentId: string, goal: string, priority = 0) {
  return prisma.agentTask.create({ data: { organizationId: orgId, agentId, goal, priority } });
}

async function makeChat(orgId: string, session: SessionContext, title: string) {
  return createKernConversation(session, {
    title,
    runtimeConfig: { ...DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG, modelProfileKey: "t011-fixture" },
  });
}

async function waitFor(predicate: () => Promise<boolean>, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timeout waiting for ${label}`);
}

function terminalTask(status: string | null | undefined): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "BLOCKED" || status === "CANCELLED";
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env[PROVIDER_ENV] = `http://127.0.0.1:${address.port}`;
  // 供失败清理回归验证「夹具端口确实已关闭」。
  if (process.env.T011_FIXTURE_PORT_FILE) {
    writeFileSync(process.env.T011_FIXTURE_PORT_FILE, String(address.port), "utf8");
  }
  console.log(`fixture: http://127.0.0.1:${address.port} provider=${PROVIDER}`);

  try {
    // ---------------------------------------------------------------- F3 参数与峰值
    console.log("▶ F3 参数校验与预算峰值");
    assert.deepEqual(resolveWorkLimits({ total: 3, perOrganization: 2 }), { total: 3, perOrganization: 2 });
    assert.deepEqual(resolveWorkLimits(), { total: 2, perOrganization: 1 }, "默认总上限 2、单组织 1");
    for (const bad of [0, -1, -4, 1.5, 0.5, NaN, Infinity, "2", "", null, {}]) {
      assert.throws(() => resolveWorkLimits({ total: bad as never }), /正整数/, `total=${String(bad)} 应被拒绝`);
      assert.throws(() => resolveWorkLimits({ perOrganization: bad as never }), /正整数/, `perOrganization=${String(bad)} 应被拒绝`);
    }
    {
      const budget: WorkBudget = configureWorkBudget({ total: 2, perOrganization: 1 });
      const a1 = budget.tryAcquire("A");
      assert.ok(a1, "orgA 第一条应拿到槽位");
      assert.equal(budget.tryAcquire("A"), null, "单组织上限 1：orgA 第二条必须被拒");
      const b1 = budget.tryAcquire("B");
      assert.ok(b1, "orgB 在总上限内应拿到槽位");
      assert.equal(budget.tryAcquire("C"), null, "总上限 2：第三条必须被拒");
      assert.deepEqual(budget.stats().inFlight, 2);
      a1!();
      b1!();
      const c1 = budget.tryAcquire("C");
      assert.ok(c1, "归还后容量必须可再取");
      c1!();
      assert.deepEqual(budget.stats().inFlight, 0);
      const twice = budget.tryAcquire("A")!;
      twice();
      twice();
      assert.deepEqual(budget.stats().inFlight, 0, "重复释放不得重复归还容量");
    }
    console.log("F3-a: 非法参数（0/负数/小数/NaN/Infinity/字符串）被拒；总上限与单组织上限按预期拦截，释放幂等");

    // ---------------------------------------------------------------- F1 阻塞不外溢
    console.log("▶ F1 组织 A 的模型 HTTP 等待时，组织 B 的会话与任务仍推进");
    const a1 = await makeOrg("T011 F1 A");
    const b1 = await makeOrg("T011 F1 B");
    probeModel.set(a1.orgId, "f1-slow");
    probeModel.set(b1.orgId, "f1-fast");
    gate("f1-slow");
    await makeProfile(a1.orgId, "f1-slow");
    await makeProfile(b1.orgId, "f1-fast");
    const agentA = await makeAgent(a1.orgId, 2);
    const agentB = await makeAgent(b1.orgId, 2);
    const taskA = await makeTask(a1.orgId, agentA.id, "F1 A slow");
    const taskB = await makeTask(b1.orgId, agentB.id, "F1 B fast");
    const chatA = await makeChat(a1.orgId, a1.session, "F1 A");
    const chatB = await makeChat(b1.orgId, b1.session, "F1 B");
    const receiptA = await acceptKernMessage(a1.session, chatA.id, { content: "A slow question", clientMessageId: randomUUID() });
    const receiptB = await acceptKernMessage(b1.session, chatB.id, { content: "B fast question", clientMessageId: randomUUID() });

    resetWorkBudgetForTest();
    const f1Start = Date.now();
    const worker = startWorker({
      once: false,
      ignoreLock: true,
      quiet: true,
      loops: ["conversation", "executor"],
      intervals: { conversation: 150, executor: 150 },
      executorBatch: 2,
      maxConcurrency: 4,
      maxPerOrganizationConcurrency: 2,
      maxTicks: 60,
    });
    const slowGate = gate("f1-slow");
    await waitFor(() => Promise.resolve(slowGate.count() >= 1), "f1-slow 进入夹具", 15_000);
    const blockedAt = Date.now();
    await waitFor(
      async () => {
        const t = await prisma.agentTask.findUnique({ where: { id: taskB.id }, select: { status: true } });
        const r = await prisma.agentRun.findUnique({ where: { id: receiptB.runId }, select: { status: true } });
        return terminalTask(t?.status) && (r?.status === "SUCCEEDED" || r?.status === "FAILED");
      },
      "B 的任务与消息在 A 阻塞期间完成",
      15_000
    );
    const bDoneAt = Date.now();
    const before = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskA.id }, select: { status: true } });
    const runBefore = await prisma.agentRun.findUniqueOrThrow({ where: { id: receiptA.runId }, select: { status: true } });
    assert.ok(!terminalTask(before.status), `A 的任务在释放前不得结束（实际 ${before.status}）`);
    assert.ok(!terminalTask(runBefore.status), `A 的消息在释放前不得结束（实际 ${runBefore.status}）`);
    console.log(
      `F1: A 阻塞于 ${blockedAt - f1Start}ms，B 于 ${bDoneAt - f1Start}ms 先完成（A=${before.status}/${runBefore.status}）`
    );
    // R5 失败清理验证入口：只在专门的回归里开启，用来证明
    // 「中途失败也不会留下进程 / 锁 / 心跳 / QUEUED 夹具」。
    if (process.env.T011_FORCE_FAILURE === "1") {
      throw new Error("injected failure: verify teardown on a red run");
    }
    slowGate.release();
    const f1Summary = (await worker) as Awaited<ReturnType<typeof runPmWorker>>;
    assert.equal(f1Summary.stoppedBy, "max-ticks");
    assert.equal(inFlightCount(), 0, "退出后不得残留未收尾的执行");
    const aDoneTask = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskA.id }, select: { status: true } });
    assert.ok(terminalTask(aDoneTask.status), `A 的任务在释放后应落终态（实际 ${aDoneTask.status}）`);
    console.log("F1-b: A 释放后正常收尾，drain 归零，无未处理 rejection");

    // ---------------------------------------------------------------- F2 候选窗口公平
    console.log("▶ F2 积压超过旧全局候选窗口时，后出现的组织仍能被领取");
    await quiesce([a1.orgId, b1.orgId]);
    const a2 = await makeOrg("T011 F2 A");
    const b2 = await makeOrg("T011 F2 B");
    probeModel.set(a2.orgId, "f2-slow");
    probeModel.set(b2.orgId, "f2-fast");
    gate("f2-slow");
    await makeProfile(a2.orgId, "f2-slow");
    await makeProfile(b2.orgId, "f2-fast");
    const agentA2 = await makeAgent(a2.orgId, 1);
    const agentB2 = await makeAgent(b2.orgId, 1);
    // A 积压 12 条（旧实现的全局窗口是 limit*4 = 8），B 只有 1 条且最「新」。
    const backlog = [];
    for (let i = 0; i < 12; i += 1) {
      backlog.push(await makeTask(a2.orgId, agentA2.id, `F2 backlog ${i}`, 10));
    }
    const taskB2 = await makeTask(b2.orgId, agentB2.id, "F2 B late arrival", 10);

    configureWorkBudget({ total: 4, perOrganization: 2 });
    await executorLoopTick({ limit: 2 });
    // 启动是异步的：等待 B 真的被领取，而不是只看轮询返回瞬间。
    await waitFor(
      async () => {
        const t = await prisma.agentTask.findUnique({ where: { id: taskB2.id }, select: { status: true } });
        return t?.status !== "QUEUED";
      },
      "B 的任务被领取（A 积压 12 条）",
      10_000
    );
    const b2AfterFirst = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskB2.id }, select: { status: true } });
    assert.notEqual(b2AfterFirst.status, "QUEUED", "A 的积压不得把 B 挤出候选窗口");
    console.log(`F2-a(executor): A 积压 12 条时 B 仍被领取（B=${b2AfterFirst.status}）`);

    const chatA2 = await makeChat(a2.orgId, a2.session, "F2 A");
    const chatB2 = await makeChat(b2.orgId, b2.session, "F2 B");
    for (let i = 0; i < 10; i += 1) {
      await acceptKernMessage(a2.session, chatA2.id, { content: `F2 backlog ${i}`, clientMessageId: randomUUID() });
    }
    const receiptB2 = await acceptKernMessage(b2.session, chatB2.id, { content: "F2 B late arrival", clientMessageId: randomUUID() });
    await runPendingKernMessagesTick({ limit: 2 });
    await waitFor(
      async () => {
        const r = await prisma.agentRun.findUnique({ where: { id: receiptB2.runId }, select: { status: true } });
        return r?.status !== "QUEUED";
      },
      "B 的消息被领取（A 积压 10 条）",
      10_000
    );
    const b2Run = await prisma.agentRun.findUniqueOrThrow({ where: { id: receiptB2.runId }, select: { status: true } });
    assert.notEqual(b2Run.status, "QUEUED", "A 的会话积压不得把 B 挤出候选窗口");
    console.log(`F2-b(conversation): A 积压 10 条时 B 仍被领取（B=${b2Run.status}）`);
    gate("f2-slow").release();
    await drainInFlight();
    await drainInFlight();

    // F2-c：组织覆盖必须看**实际执行**，不是候选计数。
    // Codex 第二轮指出：候选发现覆盖 ≠ 这些组织被领取执行；原来的断言用
    // discoverXxx 计数，被要求换成执行覆盖。这里 21 个组织各留一条常驻任务，
    // 反复真实执行，直到全部启动过为止。
    console.log("▶ F2-c 21 个组织的实际执行覆盖必须完整");
    const manyOrgs: string[] = [];
    for (let i = 0; i < 21; i++) {
      const bulk = await prisma.organization.create({ data: { code: `BULK_${tag.slice(0, 8)}_${i}`, name: "F2 bulk" } });
      createdOrgs.push(bulk.id);
      manyOrgs.push(bulk.id);
      const agent = await prisma.agent.create({ data: { organizationId: bulk.id, code: probeCode, name: "bulk", roleKey: "PM", accessMode: "ORGANIZATION" } });
      await prisma.agentTask.create({ data: { organizationId: bulk.id, agentId: agent.id, goal: `bulk ${i}`, priority: 10 } });
    }
    resetFairQueueCursorsForTest();
    resetWorkBudgetForTest();
    configureWorkBudget({ total: 2, perOrganization: 1 });
    const bulkStarted = new Set<string>();
    for (let round = 0; round < 30 && bulkStarted.size < manyOrgs.length; round++) {
      await executorLoopTick({ limit: 2 });
      await drainInFlight();
      const rows = await prisma.agentTask.findMany({
        where: { organizationId: { in: manyOrgs }, startedAt: { not: null } },
        select: { organizationId: true },
      });
      for (const row of rows) bulkStarted.add(row.organizationId);
    }
    const neverStarted = manyOrgs.filter((id) => !bulkStarted.has(id));
    assert.deepEqual(neverStarted, [], `固定窗口或页内共享 rotation 会让部分组织永不执行（缺 ${neverStarted.length} 个）`);
    console.log(`F2-c: 21 个组织在 ${bulkStarted.size}/21 全部实际执行过（预算 total=2、perOrg=1、batch=2）`);

    // F2-d：**只发现、不执行**时也必须扫过整个组织空间。
    // 必须断言全集并集，而不是「某个特定组织有没有出现」——后者取决于该组织
    // ID 在排序里的位置，是运气而不是不变量。
    for (let i = 0; i < manyOrgs.length; i++) {
      const agent = await prisma.agent.findFirstOrThrow({ where: { organizationId: manyOrgs[i], code: probeCode } });
      await prisma.agentTask.create({ data: { organizationId: manyOrgs[i], agentId: agent.id, goal: `bulk rediscovery ${i}`, priority: 10 } });
    }
    resetFairQueueCursorsForTest();
    const readSeen = new Set<string>();
    for (let i = 0; i < 15; i++) {
      for (const item of await discoverExecutorCandidates(2)) readSeen.add(item.organizationId);
    }
    const neverRead = manyOrgs.filter((id) => !readSeen.has(id));
    assert.deepEqual(neverRead, [], `只发现不执行时也必须覆盖全部组织（缺 ${neverRead.length} 个）`);
    console.log(`F2-d: 只发现不执行时，15 轮覆盖 ${readSeen.size} 个夹具组织（全集 ${manyOrgs.length}）`);
    await quiesce();

    // ---------------------------------------------------------------- F3 跨队列真实峰值
    console.log("▶ F3 跨队列在途峰值与容量恢复");
    configureWorkBudget({ total: 2, perOrganization: 1 });
    const budgetStats: Array<{ inFlight: number; byOrganization: Record<string, number> }> = [];
    const sampler = setInterval(() => budgetStats.push(getWorkBudget().stats()), 10);
    const a3 = await makeOrg("T011 F3 A");
    const b3 = await makeOrg("T011 F3 B");
    probeModel.set(a3.orgId, "f3-slow");
    probeModel.set(b3.orgId, "f3-slow");
    gate("f3-slow");
    await makeProfile(a3.orgId, "f3-slow");
    await makeProfile(b3.orgId, "f3-slow");
    const agentA3 = await makeAgent(a3.orgId, 1);
    const agentB3 = await makeAgent(b3.orgId, 1);
    await makeTask(a3.orgId, agentA3.id, "F3 A1");
    await makeTask(a3.orgId, agentA3.id, "F3 A2");
    await makeTask(b3.orgId, agentB3.id, "F3 B1");
    await makeTask(b3.orgId, agentB3.id, "F3 B2");
    await quiesce([a3.orgId, b3.orgId]);
    resetWorkBudgetForTest();
    configureWorkBudget({ total: 2, perOrganization: 1 });
    // 轮询若干次直到本场景的两个组织都真的启动；不假设「一次 tick 就能拿到两个槽位」
    // ——库里可能还有别的夹具在排队，而峰值采样才是这个场景真正要断言的东西。
    for (let i = 0; i < 6; i++) {
      await executorLoopTick({ limit: 4 });
      const started = await prisma.agentTask.count({
        where: { organizationId: { in: [a3.orgId, b3.orgId] }, startedAt: { not: null } },
      });
      if (started >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await waitFor(() => Promise.resolve(gate("f3-slow").count() >= 1), "f3 慢请求进入夹具", 10_000);
    clearInterval(sampler);
    const peak = Math.max(...budgetStats.map((s) => s.inFlight), 0);
    const peakPerOrg = Math.max(0, ...budgetStats.map((s) => Math.max(...Object.values(s.byOrganization), 0)));
    assert.ok(peak <= 2, `跨队列在途峰值 ${peak} 不得超过配置总上限 2`);
    assert.ok(peakPerOrg <= 1, `单组织在途峰值 ${peakPerOrg} 不得超过配置上限 1`);
    const startedBoth = await prisma.agentTask.count({ where: { organizationId: { in: [a3.orgId, b3.orgId] }, startedAt: { not: null } } });
    assert.ok(startedBoth >= 2, `两个组织都应启动过（实际 ${startedBoth}），否则本场景没测到跨组织并发`);
    console.log(`F3-b: 总在途峰值=${peak}（上限 2），单组织峰值=${peakPerOrg}（上限 1），两组织均已启动`);
    gate("f3-slow").release();
    await drainInFlight();
    await drainInFlight();
    assert.equal(inFlightCount(), 0, "容量必须在执行结束后归还");

    // ---------------------------------------------------------------- F4 顺序 / 幂等 / Agent 上限
    console.log("▶ F4 同会话顺序、重复接收幂等、Agent 并发上限");
    const a4 = await makeOrg("T011 F4 A");
    probeModel.set(a4.orgId, "f4-fast");
    await makeProfile(a4.orgId, "f4-fast");
    const chatA4 = await makeChat(a4.orgId, a4.session, "F4");
    const first = await acceptKernMessage(a4.session, chatA4.id, { content: "F4 first", clientMessageId: randomUUID() });
    const second = await acceptKernMessage(a4.session, chatA4.id, { content: "F4 second", clientMessageId: randomUUID() });
    // 重复接收同一 clientMessageId：只允许一条消息与一次执行
    const replay = await acceptKernMessage(a4.session, chatA4.id, { content: "F4 first", clientMessageId: (await prisma.agentRun.findUniqueOrThrow({ where: { id: first.runId }, select: { clientMessageId: true } })).clientMessageId! });
    assert.equal(replay.runId, first.runId, "重复接收必须回到同一条执行");
    assert.equal(await prisma.message.count({ where: { conversationId: chatA4.id, role: "USER" } }), 2, "重复接收不得重复落用户消息");
    configureWorkBudget({ total: 4, perOrganization: 4 });
    for (let i = 0; i < 4; i += 1) {
      await runPendingKernMessagesTick({ limit: 4, organizationId: a4.orgId });
      await drainInFlight();
    }
    const f4Runs = await prisma.agentRun.findMany({ where: { id: { in: [first.runId, second.runId] } }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(f4Runs.map((r) => r.status), ["SUCCEEDED", "SUCCEEDED"], "同会话两条消息都应完成");
    assert.ok(
      f4Runs[0].finishedAt! <= f4Runs[1].finishedAt!,
      "同会话必须严格按创建顺序完成，不得越序"
    );
    console.log(`F4-a: 同会话顺序=${f4Runs.map((r) => r.status).join("→")}，重复接收幂等`);

    await quiesce([a4.orgId]);
    const agentA4 = await makeAgent(a4.orgId, 1);
    const serialTasks = [await makeTask(a4.orgId, agentA4.id, "F4 serial 1"), await makeTask(a4.orgId, agentA4.id, "F4 serial 2")];
    probeConcurrency = 0;
    probePeak = 0;
    probeOrder.length = 0;
    for (let i = 0; i < 6; i += 1) {
      await executorLoopTick({ limit: 2, organizationId: a4.orgId });
      await drainInFlight();
      const states = await Promise.all(serialTasks.map((t) => prisma.agentTask.findUniqueOrThrow({ where: { id: t.id }, select: { status: true } })));
      if (states.every((s) => terminalTask(s.status))) break;
    }
    assert.ok(probePeak <= 1, `两个独立领取者不得突破 Agent.maxConcurrentTasks=1（实测峰值 ${probePeak}）`);
    const serialStates = await Promise.all(serialTasks.map((t) => prisma.agentTask.findUniqueOrThrow({ where: { id: t.id }, select: { status: true } })));
    assert.ok(serialStates.every((s) => terminalTask(s.status)), "两条任务都应收尾");
    assert.equal(new Set(probeOrder).size, probeOrder.length, "不得产生重复结果");
    console.log(`F4-b: Agent 并发上限峰值=${probePeak}，终态=${serialStates.map((s) => s.status).join(",")}`);

    // ---------------------------------------------------------------- F5 取消后容量归还
    console.log("▶ F5 在途取消：本地 HTTP 终止、账本关闭、容量归还，B 继续");
    const a5 = await makeOrg("T011 F5 A");
    const b5 = await makeOrg("T011 F5 B");
    probeModel.set(b5.orgId, "f5-fast");
    gate("f5-slow");
    await makeProfile(a5.orgId, "f5-slow");
    await makeProfile(b5.orgId, "f5-fast");
    const chatA5 = await makeChat(a5.orgId, a5.session, "F5 A");
    const chatB5 = await makeChat(b5.orgId, b5.session, "F5 B");
    const cancelReceipt = await acceptKernMessage(a5.session, chatA5.id, { content: "F5 cancel me", clientMessageId: randomUUID() });
    const keepReceipt = await acceptKernMessage(b5.session, chatB5.id, { content: "F5 keep going", clientMessageId: randomUUID() });
    await quiesce([a5.orgId, b5.orgId]);
    resetWorkBudgetForTest();
    configureWorkBudget({ total: 2, perOrganization: 1 });
    runPendingKernMessagesTick({ limit: 2 });
    await waitFor(() => Promise.resolve(gate("f5-slow").count() >= 1), "f5-slow 进入夹具", 10_000);
    await waitFor(
      async () => {
        const run = await prisma.agentRun.findUnique({ where: { id: keepReceipt.runId }, select: { status: true } });
        return run?.status === "SUCCEEDED" || run?.status === "FAILED";
      },
      "B 的消息在 A 取消前完成",
      10_000
    );
    await cancelInteractiveRun({ session: a5.session, runId: cancelReceipt.runId });
    await waitFor(
      async () => {
        const run = await prisma.agentRun.findUnique({ where: { id: cancelReceipt.runId }, select: { status: true } });
        return run?.status === "CANCELLED" || run?.status === "FAILED";
      },
      "被取消的消息落终态",
      10_000
    );
    await waitFor(() => Promise.resolve(gate("f5-slow").wasClosed), "夹具观察到连接被终止", 10_000);
    const cancelledRuns = await prisma.modelRun.findMany({ where: { organizationId: a5.orgId }, select: { status: true, finishedAt: true } });
    assert.ok(
      cancelledRuns.every((r) => r.status !== "RUNNING" && r.finishedAt !== null),
      "取消后账本必须关闭，不能留下 RUNNING 的 ModelRun"
    );
    gate("f5-slow").release();
    await drainInFlight();
    await drainInFlight();
    assert.equal(inFlightCount(), 0, "取消后容量必须归还");
    const keepFinal = await prisma.agentRun.findUniqueOrThrow({ where: { id: keepReceipt.runId }, select: { status: true } });
    assert.equal(keepFinal.status, "SUCCEEDED", "取消 A 不得影响 B");
    console.log(`F5: 取消后 HTTP 终止、账本=${cancelledRuns.map((r) => r.status).join(",")}、容量归还，B=${keepFinal.status}`);

    // ---------------------------------------------------------------- F7 心跳 / 收尾
    console.log("▶ F7 长等待期间心跳前进，abort/once 收尾不遗留在途");
    const a7 = await makeOrg("T011 F7 A");
    probeModel.set(a7.orgId, "f7-slow");
    gate("f7-slow");
    await makeProfile(a7.orgId, "f7-slow");
    const agentA7 = await makeAgent(a7.orgId, 1);
    await makeTask(a7.orgId, agentA7.id, "F7 slow");
    // 第二条任务保持 QUEUED：abort 之后它必须仍然没被领取，
    // 只看「已经 RUNNING 的那一条」是测不出「还在领取新工作」的。
    const pendingTask7 = await makeTask(a7.orgId, agentA7.id, "F7 must stay queued");
    await quiesce([a7.orgId]);
    resetWorkBudgetForTest();
    const beforeListeners = process.listenerCount("SIGTERM");
    // F7 走**真实文件锁**：心跳文件必须真的被创建、更新、删除。
    const realLockDir = acquireTempLockDir();
    assert.equal(existsSync(path.join(realLockDir, "lock.json")), false, "启动前不应存在锁文件");
    const worker7 = startWorker({
      once: false,
      quiet: true,
      loops: ["executor"],
      intervals: { executor: 150 },
      executorBatch: 1,
      maxConcurrency: 1,
      maxPerOrganizationConcurrency: 1,
    });
    await waitFor(() => Promise.resolve(gate("f7-slow").count() >= 1), "f7-slow 进入夹具", 10_000);
    assert.ok(existsSync(path.join(realLockDir, "lock.json")), "真实文件锁必须已创建");
    // R1：持锁进程仍活着时，**另一个进程**必须被拒绝启动。
    // 不能只看「锁文件短暂存在」——必须真的起一个进程去抢锁并被拒。
    const contender = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", "import { acquireWorkerLock } from './src/modules/worker/index'; const lock = acquireWorkerLock(); if (!lock) { console.log('REFUSED'); } else { console.log('ACQUIRED'); }"],
      { encoding: "utf8", env: { ...process.env, PM_WORKER_LOCK_DIR: realLockDir } }
    );
    assert.match(contender.stdout, /REFUSED/, `另一个进程必须被拒绝启动（实际输出：${contender.stdout.trim()} ${contender.stderr.trim()}）`);
    // 心跳写入有 10s 节流（BEAT_THROTTLE_MS），因此这里等到下一次真实写入为止，
    // 而不是假设某个 sleep 就够了。
    const firstBeat = await prisma.pmWorkerHeartbeat.findUniqueOrThrow({ where: { workerId: PROCESS_WORKER_ID }, select: { heartbeatAt: true } });
    await waitFor(
      async () => {
        const row = await prisma.pmWorkerHeartbeat.findUnique({ where: { workerId: PROCESS_WORKER_ID }, select: { heartbeatAt: true, stoppedAt: true } });
        return !!row && row.heartbeatAt > firstBeat.heartbeatAt && row.stoppedAt === null;
      },
      "长等待期间心跳继续前进",
      20_000
    );
    liveControllers.values().next().value?.abort();
    await new Promise((resolve) => setTimeout(resolve, 400));
    // R5：在真实锁已存在、HTTP 尚未释放时注入失败，验证失败路径也收尾。
    if (process.env.T011_FORCE_FAILURE === "f7") {
      throw new Error("injected failure while holding the real worker lock");
    }
    const pendingState = await prisma.agentTask.findUniqueOrThrow({ where: { id: pendingTask7.id }, select: { status: true, startedAt: true } });
    assert.equal(pendingState.status, "QUEUED", "abort 后不得再领取待领取的工作");
    assert.equal(pendingState.startedAt, null, "abort 后的待领取任务不得留下 startedAt");
    gate("f7-slow").release();
    const summary7 = (await worker7) as Awaited<ReturnType<typeof runPmWorker>>;
    assert.equal(summary7.stoppedBy, "signal");
    assert.equal(process.listenerCount("SIGTERM"), beforeListeners, "不得遗留进程级信号监听");
    assert.equal(inFlightCount(), 0, "退出后不得残留在途执行");
    const stopped = await prisma.pmWorkerHeartbeat.findUnique({ where: { workerId: PROCESS_WORKER_ID }, select: { stoppedAt: true } });
    assert.ok(stopped?.stoppedAt, "退出后必须写停止心跳");
    assert.equal(existsSync(path.join(realLockDir, "lock.json")), false, "退出后必须释放真实文件锁");
    console.log("F7: 心跳在长等待期间前进；abort 后待领取任务保持 QUEUED、真实锁已释放，监听与在途均归零");

    // ---------------------------------------------------------------- F8 组织限定
    console.log("▶ F8 organizationId 限定只处理指定组织");
    const a8 = await makeOrg("T011 F8 A");
    const b8 = await makeOrg("T011 F8 B");
    probeModel.set(a8.orgId, "f8-fast");
    probeModel.set(b8.orgId, "f8-fast");
    await makeProfile(a8.orgId, "f8-fast");
    await makeProfile(b8.orgId, "f8-fast");
    const agentA8 = await makeAgent(a8.orgId, 1);
    const agentB8 = await makeAgent(b8.orgId, 1);
    const taskA8 = await makeTask(a8.orgId, agentA8.id, "F8 A scoped out");
    const taskB8 = await makeTask(b8.orgId, agentB8.id, "F8 B scoped in");
    const chatA8 = await makeChat(a8.orgId, a8.session, "F8 A");
    const chatB8 = await makeChat(b8.orgId, b8.session, "F8 B");
    const receiptA8 = await acceptKernMessage(a8.session, chatA8.id, { content: "F8 A", clientMessageId: randomUUID() });
    const receiptB8 = await acceptKernMessage(b8.session, chatB8.id, { content: "F8 B", clientMessageId: randomUUID() });
    await quiesce([a8.orgId, b8.orgId]);
    resetWorkBudgetForTest();
    configureWorkBudget({ total: 4, perOrganization: 4 });
    await executorLoopTick({ limit: 4, organizationId: b8.orgId });
    await runPendingKernMessagesTick({ limit: 4, organizationId: b8.orgId });
    await drainInFlight();
    const scoped = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskB8.id }, select: { status: true } });
    const outA = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskA8.id }, select: { status: true } });
    const runB8 = await prisma.agentRun.findUniqueOrThrow({ where: { id: receiptB8.runId }, select: { status: true } });
    const runA8 = await prisma.agentRun.findUniqueOrThrow({ where: { id: receiptA8.runId }, select: { status: true } });
    assert.ok(terminalTask(scoped.status), `指定组织的任务应推进（实际 ${scoped.status}）`);
    assert.equal(outA.status, "QUEUED", "范围外的组织任务必须保持 QUEUED");
    assert.equal(runA8.status, "QUEUED", "范围外的组织消息必须保持 QUEUED");
    assert.equal(runB8.status, "SUCCEEDED");
    console.log(`F8: 仅 ${b8.orgId.slice(0, 8)} 被处理（A 任务=${outA.status}、A 消息=${runA8.status}，B 任务=${scoped.status}、B 消息=${runB8.status}）`);

    console.log(`\n通过：fast 模型请求=${fastCalls.length} 次，探针峰值并发=${probePeak}`);
    console.log("PASS TASK-011 worker fairness (F1/F2/F3/F4/F5/F7/F8)");
    console.log("F6 说明：失联接管、旧执行者晚返回、额度预留原子性与重试/fallback 账本一致性，由既有回归覆盖 —— 见交付记录中的对应命令与断言位置。");
  } finally {
    // 顺序很重要：先停所有常驻 Worker 并等它们退出，再释放 HTTP 屏障、断连数据库。
    // 否则断言失败会留下后台进程继续执行其它测试创建的组织任务（R5）。
    for (const controller of liveControllers) controller.abort();
    for (const g of gates.values()) g.release();
    await Promise.allSettled([...liveWorkers]);
    await drainInFlight().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env[PROVIDER_ENV];
    delete registry.strategies[probeCode];
    resetWorkBudgetForTest();
    resetFairQueueCursorsForTest();
    await prisma.pmWorkerHeartbeat.deleteMany({ where: { workerId: PROCESS_WORKER_ID } }).catch(() => undefined);
    for (const restore of tempResources.splice(0)) {
      try { restore(); } catch (error) { console.error("[cleanup] 临时资源恢复失败：", error); }
    }
    // 只清理本次创建的 id；按外键顺序先删审计，避免把别人的夹具带走。
    try {
      await cleanupFixtures();
    } catch (error) {
      // 清理失败必须显式报告，不能静默吞掉后让人以为环境干净。
      console.error("[cleanup] 夹具清理失败：", error);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
