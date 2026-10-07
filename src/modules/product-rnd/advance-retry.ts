/**
 * KX-05：产品研发主任务 advance 失败后的自动重试（纯函数，无数据库依赖）。
 *
 * 失败状态编码在主任务的 blockedReason 里，不加表、不加迁移：
 *   AUTO_ADVANCE_FAILED[<次数>]@<ISO 时间>: <原因>
 * 旧格式「AUTO_ADVANCE_FAILED: <原因>」按第 1 次、时间未知处理（立即可重试）。
 *
 * 退避：30s · 2^(n-1)，封顶 30 分钟；连续失败 MAX_AUTO_ATTEMPTS 次后停止自动重试，
 * 交给界面上的「立即重试」由人决定。成功推进时 orchestrator 会把 blockedReason 清空。
 */

export const AUTO_ADVANCE_PREFIX = "AUTO_ADVANCE_FAILED";
export const MAX_AUTO_ATTEMPTS = 6;
export const BASE_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 30 * 60_000;

export interface AdvanceFailure {
  attempts: number;
  lastAt: Date | null;
  message: string;
}

const PATTERN = /^AUTO_ADVANCE_FAILED(?:\[(\d+)\])?(?:@([0-9TZ:.+-]+))?:\s?([\s\S]*)$/;

export function parseAdvanceFailure(blockedReason: string | null | undefined): AdvanceFailure | null {
  if (!blockedReason) return null;
  const m = PATTERN.exec(blockedReason);
  if (!m) return null;
  const attempts = Math.max(1, Number(m[1] ?? 1) || 1);
  const at = m[2] ? new Date(m[2]) : null;
  return { attempts, lastAt: at && !Number.isNaN(at.getTime()) ? at : null, message: m[3] ?? "" };
}

export function encodeAdvanceFailure(failure: AdvanceFailure): string {
  const at = (failure.lastAt ?? new Date()).toISOString();
  return `${AUTO_ADVANCE_PREFIX}[${failure.attempts}]@${at}: ${failure.message}`.slice(0, 1000);
}

/** 在上一次失败（可为空）基础上记一次新失败。 */
export function nextAdvanceFailure(
  previousBlockedReason: string | null | undefined,
  message: string,
  now: Date = new Date()
): string {
  const prev = parseAdvanceFailure(previousBlockedReason);
  return encodeAdvanceFailure({ attempts: (prev?.attempts ?? 0) + 1, lastAt: now, message });
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

export type RetryDecision =
  | { kind: "RUN" }
  | { kind: "WAIT"; nextRetryAt: Date }
  | { kind: "EXHAUSTED"; attempts: number };

/** worker 巡检是否应该现在重试这个主任务。 */
export function decideAutoRetry(blockedReason: string | null | undefined, now: Date = new Date()): RetryDecision {
  const failure = parseAdvanceFailure(blockedReason);
  if (!failure) return { kind: "RUN" };
  if (failure.attempts >= MAX_AUTO_ATTEMPTS) return { kind: "EXHAUSTED", attempts: failure.attempts };
  if (!failure.lastAt) return { kind: "RUN" };
  const due = new Date(failure.lastAt.getTime() + backoffMs(failure.attempts));
  return due.getTime() <= now.getTime() ? { kind: "RUN" } : { kind: "WAIT", nextRetryAt: due };
}

/** 给界面用的视图：没有失败时为 null。 */
export function describeAutoAdvance(blockedReason: string | null | undefined, now: Date = new Date()) {
  const failure = parseAdvanceFailure(blockedReason);
  if (!failure) return null;
  const decision = decideAutoRetry(blockedReason, now);
  return {
    attempts: failure.attempts,
    maxAttempts: MAX_AUTO_ATTEMPTS,
    message: failure.message,
    lastFailedAt: failure.lastAt?.toISOString() ?? null,
    nextRetryAt: decision.kind === "WAIT" ? decision.nextRetryAt.toISOString() : null,
    exhausted: decision.kind === "EXHAUSTED",
  };
}

export type AutoAdvanceView = NonNullable<ReturnType<typeof describeAutoAdvance>>;
