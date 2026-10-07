import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  eventLoopOnce,
  executorLoopOnce,
  executorLoopTick,
  reconcileLoopOnce,
  researchLoopOnce,
  scheduleLoopOnce,
  type LoopResult,
} from "./loops";
import { workerHandlers } from "./registry";
import { beatWorker, markWorkerStopped } from "./heartbeat";
import { configureWorkBudget, drainInFlight, resolveWorkLimits } from "./scheduler";

/**
 * 统一 PM Worker
 * ==============
 *
 * 一个进程、四个 loop、一套退出信号。目标是把系统从「请求链路驱动」变成
 * 「关掉浏览器 AI 还在干活」：
 *
 *   executorLoop   5s    QUEUED AgentTask → Digital Employee Executor
 *   eventLoop      10s   BusinessEvent outbox drain（复用既有 lease/attempt）
 *   researchLoop   30s   ResearchRun resume → 执行 → 发布
 *   reconcileLoop  60s   Product R&D advance（排队 QA / 合成报告 / 收尾）
 *
 * 单实例保证用**文件锁 + 心跳**（不做分布式抢占，单机场景足够）：
 * 锁里记 pid + heartbeatAt；启动时若发现锁还热且 pid 还活着就拒绝启动，
 * 否则视为陈旧锁接管。锁目录默认 `.pm-worker/`（已 gitignore）。
 */

export type WorkerLoopName = "conversation" | "executor" | "research" | "event" | "reconcile" | "schedule";

export const DEFAULT_LOOP_ORDER: WorkerLoopName[] = [
  "schedule",
  "conversation",
  "executor",
  "research",
  "reconcile",
  "event",
];

const DEFAULT_INTERVAL_MS: Record<WorkerLoopName, number> = {
  conversation: 1000,
  executor: 5_000,
  research: 30_000,
  event: 10_000,
  reconcile: 60_000,
  schedule: 30_000,
};


export interface PmWorkerOptions {
  /** 跑一轮就退出（幂等单次模式，供定时任务/cron 与测试使用）。 */
  once?: boolean;
  loops?: WorkerLoopName[];
  intervals?: Partial<Record<WorkerLoopName, number>>;
  /**
   * 单轮轮询「最多启动」的任务/消息条数（批次大小），**不是**并发上限。
   * 真实总并发由 maxConcurrency / maxPerOrganizationConcurrency 约束；
   * 两队列（会话与 executor）共用同一预算，不会把总上限翻倍。
   */
  executorBatch?: number;
  /** 进程级并发总上限（conversation+executor 合计）。默认 2。 */
  maxConcurrency?: number;
  /** 单组织并发上限。默认 1。 */
  maxPerOrganizationConcurrency?: number;
  /** 收窄到单个组织（测试/单租户部署用；缺省多组织）。 */
  organizationId?: string;
  /** 非 once 模式下的最大轮数（测试/调试用，缺省无限）。 */
  maxTicks?: number;
  quiet?: boolean;
  /** 跳过单实例文件锁（测试用）。 */
  ignoreLock?: boolean;
  /** 外部中止信号。 */
  signal?: AbortSignal;
}

export interface PmWorkerRunSummary {
  ticks: number;
  results: Partial<Record<WorkerLoopName, LoopResult>>;
  stoppedBy: "once" | "max-ticks" | "signal" | "lock-held" | "heartbeat-failed";
  /** 文件/数据库心跳失败时的原始错误（成功路径为 null）。 */
  heartbeatError?: string | null;
}

interface LockState {
  workerId: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
}

function lockDir(): string {
  return process.env.PM_WORKER_LOCK_DIR ?? path.resolve(process.cwd(), ".pm-worker");
}

function lockFile(): string {
  return path.join(lockDir(), "lock.json");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = 进程存在但无权发信号（例如别的用户起的 Worker）—— 仍然算活着。
    // 只有 ESRCH 才是「进程不存在」。
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function readLock(): LockState | null {
  try {
    const raw = readFileSync(lockFile(), "utf8");
    const parsed = JSON.parse(raw) as LockState;
    if (!parsed?.workerId || typeof parsed.pid !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 尝试获取单实例锁。返回 null 表示已有活跃 Worker（应放弃启动）。
 */
export function acquireWorkerLock(workerId: string = randomUUID()): LockState | null {
  mkdirSync(lockDir(), { recursive: true });
  const existing = readLock();
  if (existing) {
    const age = Date.now() - new Date(existing.heartbeatAt).getTime();
    const alive = pidAlive(existing.pid);
    if (alive && existing.pid !== process.pid) {
      /**
       * 持有者进程还活着，就**一律**拒绝接管 —— 不看心跳年龄。
       *
       * 排空期间（等待已领取的执行收尾）刷不出心跳是正常状态，那段时间可能很长。
       * 若按年龄判定「旧执行已失权」并覆盖锁，新旧两个进程会同时执行；本机活进程
       * 保护的成本远低于一套要证明「所有旧执行都无法继续提交」的撤权协议。
       *
       * 进程真的卡死时的处置：先确认旧进程已终止（它一退出，本文件的心跳过期
       * 回收路径自然生效），再取锁；不要靠年龄硬抢。
       */
      console.error(
        `[pm-worker] 已有活跃 Worker（pid=${existing.pid}, 心跳 ${Math.round(
          age / 1000
        )}s 前，进程仍存活），本进程退出。需要接管请先确认该进程已终止。`
      );
      return null;
    }
  }
  const state: LockState = {
    workerId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  writeLock(state);
  return state;
}

function writeLock(state: LockState): void {
  const target = lockFile();
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, target);
}

export function heartbeatWorkerLock(workerId: string): void {
  const current = readLock();
  if (current && current.workerId !== workerId) return; // 已被接管
  writeLock({
    workerId,
    pid: process.pid,
    startedAt: current?.startedAt ?? new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  });
}

export function releaseWorkerLock(workerId: string): void {
  const current = readLock();
  if (current && current.workerId !== workerId) return;
  try {
    if (existsSync(lockFile())) unlinkSync(lockFile());
  } catch {
    // 锁文件删不掉不影响正确性（心跳过期后可被接管）
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOneLoop(
  loop: WorkerLoopName,
  options: PmWorkerOptions,
  launchOnly = false,
  admission?: () => boolean
): Promise<LoopResult> {
  const scope = {
    ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    ...(admission ? { admission } : {}),
  };
  switch (loop) {
    case "conversation":
      if (launchOnly) {
        return workerHandlers().conversations?.runPendingTick?.({ limit: options.executorBatch ?? 2, ...scope }) ?? { scanned: 0, acted: 0, skipped: 0, errors: 0 };
      }
      return workerHandlers().conversations?.runPending({ limit: options.executorBatch ?? 2, ...scope }) ?? { scanned: 0, acted: 0, skipped: 0, errors: 0 };
    case "executor":
      if (launchOnly) {
        return executorLoopTick({ limit: options.executorBatch ?? 2, ...scope });
      }
      return executorLoopOnce({ limit: options.executorBatch ?? 2, ...scope });
    case "research":
      return researchLoopOnce(scope);
    case "event":
      return eventLoopOnce(scope);
    case "reconcile":
      return reconcileLoopOnce(scope);
    case "schedule":
      return scheduleLoopOnce(scope);
  }
}

function logResult(loop: WorkerLoopName, result: LoopResult, quiet: boolean): void {
  if (quiet) return;
  if (
    result.scanned === 0 &&
    result.acted === 0 &&
    result.errors === 0
  ) {
    return;
  }
  const notes = result.notes?.length ? ` | ${result.notes.join("; ")}` : "";
  console.log(
    `[pm-worker] ${loop} scanned=${result.scanned} acted=${result.acted} skipped=${result.skipped} errors=${result.errors}${notes}`
  );
}

/**
 * 主入口。
 *
 * `once: true` 时按固定顺序（executor → research → reconcile → event）各跑一轮：
 * 这个顺序保证「先执行完专家任务，再 reconcile 排队 QA」，单次调用即可推进一整步。
 */
export async function runPmWorker(
  options: PmWorkerOptions = {}
): Promise<PmWorkerRunSummary> {
  const loops =
    options.loops?.length ? options.loops : DEFAULT_LOOP_ORDER.slice();
  const quiet = options.quiet ?? false;
  const results: Partial<Record<WorkerLoopName, LoopResult>> = {};

  if (!options.once) {
    // 配置进程级并发预算；loop 只轮询，不等待业务执行。
    configureWorkBudget(resolveWorkLimits({ total: options.maxConcurrency, perOrganization: options.maxPerOrganizationConcurrency }));
  }

  const lock = options.ignoreLock
    ? { workerId: randomUUID() }
    : acquireWorkerLock();
  if (!lock) {
    return { ticks: 0, results, stoppedBy: "lock-held" };
  }
  const workerId = lock.workerId;
  const startedAt = new Date();
  const beat = (force = false) =>
    beatWorker({ loops, startedAt, organizationId: options.organizationId }, force).catch((error: unknown) => {
      if (!quiet) console.error("[pm-worker] 心跳写入失败：", error instanceof Error ? error.message : error);
    });
  await beat(true);

  let stoppedBy: PmWorkerRunSummary["stoppedBy"] = "max-ticks";
  let heartbeatError: string | null = null;
  let stop = false;
  /**
   * 准入开关：只阻止**新的**领取，不取消在途执行。
   * 关闭后，已经拿到槽位但还没领取的工作必须把槽位还回去（见两个 tick）。
   */
  let admissionOpen = true;
  const admission = () => admissionOpen;
  const onSignal = () => {
    stoppedBy = "signal";
    stop = true;
    admissionOpen = false;
    if (!quiet) console.log("[pm-worker] 收到退出信号，停止领取并等待在途工作收尾…");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  options.signal?.addEventListener("abort", onSignal, { once: true });
  if (options.signal?.aborted) onSignal();

  // Slow asynchronous steps must not make a healthy process look dead.
  // Serialize writes and drain the last write before marking this worker stopped.
  let beating = false;
  let pendingBeat: Promise<void> = Promise.resolve();
  /**
   * 文件心跳失败不是「日志里记一笔就继续」：锁刷不出来意味着单实例所有权
   * 已经无法维持，继续领取新工作会让两个进程同时执行。因此它等价于一次
   * 内部停止信号 —— 关闭新准入、停止轮询、进入统一排空路径，
   * 但**保留错误事实**（日志 + summary.stoppedBy = "heartbeat-failed"）。
   */
  const onHeartbeatFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (heartbeatError === null) heartbeatError = message;
    if (stoppedBy !== "signal" && stoppedBy !== "once") stoppedBy = "heartbeat-failed";
    admissionOpen = false;
    stop = true;
    if (!quiet) console.error("[pm-worker] 心跳失败，停止领取新工作并收尾：", message);
  };
  const heartbeatTimer = setInterval(() => {
    if (beating) return;
    beating = true;
    pendingBeat = (async () => {
      try {
        if (!options.ignoreLock) heartbeatWorkerLock(workerId);
        await beat();
      } catch (error) {
        onHeartbeatFailure(error);
      } finally { beating = false; }
    })();
  }, 10_000);
  heartbeatTimer.unref();

  // 在途轮询集合提升到 try 之外：finally 必须在任何退出路径上都能看到它。
  const loopPolls = new Set<Promise<void>>();
  let ticks = 0;
  try {
    if (options.once) {
      for (const loop of loops) {
        if (stop) break;
        const result = await runOneLoop(loop, options, false, admission);
        results[loop] = result;
        logResult(loop, result, quiet);
      }
      if (!stop) stoppedBy = "once";
      ticks = 1;
    } else {
      const intervalOf = (loop: WorkerLoopName) =>
        options.intervals?.[loop] ?? DEFAULT_INTERVAL_MS[loop];
      const nextDueAt: Record<string, number> = {};
      for (const loop of loops) nextDueAt[loop] = 0;
      const inFlightLoops = new Set<WorkerLoopName>();

      while (!stop) {
        const now = Date.now();
        const due = loops.filter((loop) => nextDueAt[loop] <= now && !inFlightLoops.has(loop));
        for (const loop of due) {
          if (stop) break;
          inFlightLoops.add(loop);
          const launching = loop === "conversation" || loop === "executor";
          const promise = (async () => {
            try {
              const result = await runOneLoop(loop, options, launching, admission);
              results[loop] = result;
              logResult(loop, result, quiet);
            } catch (error) {
              if (!quiet) console.error(`[pm-worker] ${loop} 轮询失败：`, error instanceof Error ? error.message : error);
            } finally {
              inFlightLoops.delete(loop);
            }
          })();
          loopPolls.add(promise);
          promise.catch((error) => {
            if (!quiet) console.error(`[pm-worker] ${loop} 轮询失败：`, error instanceof Error ? error.message : error);
          }).finally(() => loopPolls.delete(promise));
          nextDueAt[loop] = Date.now() + intervalOf(loop);
        }
        await beat();
        ticks += 1;
        if (options.maxTicks && ticks >= options.maxTicks) {
          admissionOpen = false;
          break;
        }
        if (stop) break;

        const upcoming = Math.min(
          ...loops.map((loop) => nextDueAt[loop] - Date.now())
        );
        await sleep(Math.max(200, Math.min(upcoming, 2_000)));
      }
    }
  } finally {
    /**
     * 统一收尾（R1）：**所有**退出路径 —— 正常结束、signal、maxTicks、以及
     * 任何异常抛出 —— 都必须按同一顺序走完：
     *   1. 关闭新工作准入；
     *   2. 等当前各 loop 的轮询收尾；
     *   3. drain 已领取的业务执行（它们仍有提交权）；
     *   4. 才停心跳定时器、释放文件锁、写 stopped。
     * 异常照旧向上抛出（不吞），但绝不因为异常就提前释放所有权。
     */
    admissionOpen = false;
    await Promise.allSettled([...loopPolls]);
    await drainInFlight();
    clearInterval(heartbeatTimer);
    await pendingBeat;
    options.signal?.removeEventListener("abort", onSignal);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!options.ignoreLock) releaseWorkerLock(workerId);
    await markWorkerStopped().catch(() => undefined);
  }

  return { ticks, results, stoppedBy, heartbeatError };
}
