/**
 * AgentTask 失败重试退避。
 *
 * 策略：1min → 5min → 25min，3 次后不再重排（保持 FAILED，交由报告 unknowns
 * 呈现给人看）。不退避到指数爆炸，是因为本地单机场景下「快速三次」比「慢速多次」
 * 更容易被人发现；超过 3 次通常意味着代码/数据问题，不是抖动。
 */
export const MAX_EXECUTOR_ATTEMPTS = 3;

const BACKOFF_MS = [60_000, 5 * 60_000, 25 * 60_000];

export function backoffForAttempt(attempt: number): number {
  const index = Math.max(0, Math.min(attempt - 1, BACKOFF_MS.length - 1));
  return BACKOFF_MS[index];
}
