import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_AUTO_ATTEMPTS,
  backoffMs,
  decideAutoRetry,
  describeAutoAdvance,
  nextAdvanceFailure,
  parseAdvanceFailure,
} from "../src/modules/product-rnd/advance-retry";

const t0 = new Date("2026-09-28T00:00:00.000Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

test("AR1：无失败 → 立即运行；旧格式按第 1 次处理且可立即重试", () => {
  assert.deepEqual(decideAutoRetry(null, t0), { kind: "RUN" });
  assert.deepEqual(decideAutoRetry("Product R&D program is missing researchRunId.", t0), { kind: "RUN" });
  const legacy = parseAdvanceFailure("AUTO_ADVANCE_FAILED: boom");
  assert.equal(legacy?.attempts, 1);
  assert.equal(legacy?.lastAt, null);
  assert.deepEqual(decideAutoRetry("AUTO_ADVANCE_FAILED: boom", t0), { kind: "RUN" });
});

test("AR2：次数累加，时间与原因可回读", () => {
  const one = nextAdvanceFailure(null, "db down", t0);
  const two = nextAdvanceFailure(one, "still down", later(60_000));
  const parsed = parseAdvanceFailure(two);
  assert.equal(parsed?.attempts, 2);
  assert.equal(parsed?.message, "still down");
  assert.equal(parsed?.lastAt?.toISOString(), later(60_000).toISOString());
});

test("AR3：指数退避并封顶", () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(20), 30 * 60_000);
  const one = nextAdvanceFailure(null, "x", t0);
  assert.equal(decideAutoRetry(one, later(10_000)).kind, "WAIT");
  assert.equal(decideAutoRetry(one, later(30_000)).kind, "RUN");
});

test("AR4：达到上限后停止自动重试，界面显示需要人", () => {
  let reason: string | null = null;
  for (let i = 0; i < MAX_AUTO_ATTEMPTS; i += 1) reason = nextAdvanceFailure(reason, "x", t0);
  assert.deepEqual(decideAutoRetry(reason, later(24 * 3600_000)), { kind: "EXHAUSTED", attempts: MAX_AUTO_ATTEMPTS });
  const view = describeAutoAdvance(reason, t0);
  assert.equal(view?.exhausted, true);
  assert.equal(view?.nextRetryAt, null);
  assert.equal(describeAutoAdvance(null), null);
});

test("AR5：原因过长被截断到 1000 字符", () => {
  assert.ok(nextAdvanceFailure(null, "y".repeat(5000), t0).length <= 1000);
});
