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
  reconcileLoopOnce,
  researchLoopOnce,
  type LoopResult,
} from "./loops";

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

export type WorkerLoopName = "executor" | "research" | "event" | "reconcile";

export const DEFAULT_LOOP_ORDER: WorkerLoopName[] = [
  "executor",
  "research",
  "reconcile",
  "event",
];

const DEFAULT_INTERVAL_MS: Record<WorkerLoopName, number> = {
  executor: 5_000,
  research: 30_000,
  event: 10_000,
  reconcile: 60_000,
};

const LOCK_STALE_MS = 60_000;

export interface PmWorkerOptions {
  /** 跑一轮就退出（幂等单次模式，供定时任务/cron 与测试使用）。 */
  once?: boolean;
  loops?: WorkerLoopName[];
  intervals?: Partial<Record<WorkerLoopName, number>>;
  /** 每轮 executor 并发处理的 task 数上限。 */
  executorBatch?: number;
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
  stoppedBy: "once" | "max-ticks" | "signal";
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
    if (alive && age < LOCK_STALE_MS && existing.pid !== process.pid) {
      console.error(
        `[pm-worker] 已有活跃 Worker（pid=${existing.pid}, 心跳 ${Math.round(
          age / 1000
        )}s 前），本进程退出。`
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
  options: PmWorkerOptions
): Promise<LoopResult> {
  const scope = options.organizationId
    ? { organizationId: options.organizationId }
    : {};
  switch (loop) {
    case "executor":
      return executorLoopOnce({
        limit: options.executorBatch ?? 2,
        ...scope,
      });
    case "research":
      return researchLoopOnce(scope);
    case "event":
      return eventLoopOnce(scope);
    case "reconcile":
      return reconcileLoopOnce(scope);
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

  const lock = options.ignoreLock
    ? { workerId: randomUUID() }
    : acquireWorkerLock();
  if (!lock) {
    return { ticks: 0, results, stoppedBy: "signal" };
  }
  const workerId = lock.workerId;

  let stoppedBy: PmWorkerRunSummary["stoppedBy"] = "max-ticks";
  let stop = false;
  const onSignal = () => {
    stoppedBy = "signal";
    stop = true;
    if (!quiet) console.log("[pm-worker] 收到退出信号，等待当前轮结束…");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  options.signal?.addEventListener("abort", () => {
    stoppedBy = "signal";
    stop = true;
  });

  let ticks = 0;
  try {
    if (options.once) {
      for (const loop of loops) {
        if (stop) break;
        const result = await runOneLoop(loop, options);
        results[loop] = result;
        logResult(loop, result, quiet);
      }
      stoppedBy = "once";
      ticks = 1;
    } else {
      const intervalOf = (loop: WorkerLoopName) =>
        options.intervals?.[loop] ?? DEFAULT_INTERVAL_MS[loop];
      const nextDueAt: Record<string, number> = {};
      for (const loop of loops) nextDueAt[loop] = 0;

      while (!stop) {
        const now = Date.now();
        const due = loops.filter((loop) => nextDueAt[loop] <= now);
        for (const loop of due) {
          if (stop) break;
          const result = await runOneLoop(loop, options);
          results[loop] = result;
          logResult(loop, result, quiet);
          nextDueAt[loop] = Date.now() + intervalOf(loop);
        }
        heartbeatWorkerLock(workerId);
        ticks += 1;
        if (options.maxTicks && ticks >= options.maxTicks) break;
        if (stop) break;

        const upcoming = Math.min(
          ...loops.map((loop) => nextDueAt[loop] - Date.now())
        );
        await sleep(Math.max(200, Math.min(upcoming, 2_000)));
      }
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!options.ignoreLock) releaseWorkerLock(workerId);
  }

  return { ticks, results, stoppedBy };
}
