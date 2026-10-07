/**
 * KX-34b · Worker 守护策略（纯函数，供 scripts/pm-worker-supervisor.ts 使用并单测）。
 */

/** Worker 发现已有活跃实例时的退出码（EX_TEMPFAIL）。守护进程据此慢速等待，不会疯狂重启。 */
export const LOCK_HELD_EXIT_CODE = 75;
export const STABLE_UPTIME_MS = 5 * 60_000;
export const LOCK_WAIT_MS = 30_000;

/** 第 n 次连续崩溃后的等待：1s、2s、4s… 封顶 60s。 */
export function restartDelayMs(consecutiveCrashes: number, baseMs = 1_000, maxMs = 60_000): number {
  const n = Math.max(1, consecutiveCrashes);
  return Math.min(maxMs, baseMs * 2 ** (n - 1));
}

/** 跑满 5 分钟算稳定，崩溃计数从 1 重新开始。 */
export function nextCrashCount(previous: number, uptimeMs: number, stableMs = STABLE_UPTIME_MS): number {
  return uptimeMs >= stableMs ? 1 : previous + 1;
}

export type ExitDecision = { action: "stop" } | { action: "restart"; delayMs: number; crashes: number };

export function decideAfterExit(input: { code: number | null; stopping: boolean; uptimeMs: number; crashes: number }): ExitDecision {
  if (input.stopping) return { action: "stop" };
  if (input.code === LOCK_HELD_EXIT_CODE) return { action: "restart", delayMs: LOCK_WAIT_MS, crashes: 0 };
  // 正常退出（0）也重启：常驻 Worker 不应该自己停下；只有收到守护进程的停止信号才停。
  const crashes = nextCrashCount(input.crashes, input.uptimeMs);
  return { action: "restart", delayMs: restartDelayMs(crashes), crashes };
}
