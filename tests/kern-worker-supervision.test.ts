/** KX-34b Worker 常驻：守护策略、健康判定、单实例锁（重复启动）。纯逻辑 + 临时目录，不连数据库。 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LOCK_HELD_EXIT_CODE, decideAfterExit, nextCrashCount, restartDelayMs } from "../src/modules/worker/supervisor-policy";
import { WORKER_STALE_MS, classifyWorkerHealth } from "../src/modules/worker/heartbeat";
import { acquireWorkerLock, releaseWorkerLock } from "../src/modules/supervisor/worker-runtime";

test("WS1 崩溃退避：1s 起指数增长，封顶 60s；稳定 5 分钟后清零", () => {
  assert.deepEqual([1, 2, 3, 4, 7, 20].map((n) => restartDelayMs(n)), [1000, 2000, 4000, 8000, 60000, 60000]);
  assert.equal(nextCrashCount(4, 10_000), 5);
  assert.equal(nextCrashCount(4, 6 * 60_000), 1);
});

test("WS2 退出决策：停止信号 → 停；锁被占 → 30s 慢等；其他（含 0）→ 退避重启", () => {
  assert.deepEqual(decideAfterExit({ code: 1, stopping: true, uptimeMs: 1, crashes: 3 }), { action: "stop" });
  assert.deepEqual(decideAfterExit({ code: LOCK_HELD_EXIT_CODE, stopping: false, uptimeMs: 1, crashes: 3 }), { action: "restart", delayMs: 30_000, crashes: 0 });
  assert.deepEqual(decideAfterExit({ code: 1, stopping: false, uptimeMs: 500, crashes: 2 }), { action: "restart", delayMs: 4000, crashes: 3 });
  assert.deepEqual(decideAfterExit({ code: 0, stopping: false, uptimeMs: 10 * 60_000, crashes: 5 }), { action: "restart", delayMs: 1000, crashes: 1 });
});

test("WS3 健康判定：有一个活着就是 running；否则区分 stopped / stale / never", () => {
  const now = new Date("2026-09-28T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  assert.equal(classifyWorkerHealth([], now).status, "never");
  const fresh = { heartbeatAt: ago(5_000), startedAt: ago(60_000), stoppedAt: null };
  const dead = { heartbeatAt: ago(WORKER_STALE_MS + 1), startedAt: ago(600_000), stoppedAt: null };
  const stopped = { heartbeatAt: ago(1_000), startedAt: ago(600_000), stoppedAt: ago(1_000) };
  assert.deepEqual(classifyWorkerHealth([dead, fresh], now), { status: "running", running: 1, heartbeatAt: fresh.heartbeatAt.toISOString(), startedAt: fresh.startedAt.toISOString() });
  assert.equal(classifyWorkerHealth([dead], now).status, "stale");
  assert.equal(classifyWorkerHealth([stopped, dead], now).status, "stopped");
});

/**
 * WS4 的契约跟的是 acquireWorkerLock 里的那条不变式：**持锁进程还活着就一律拒绝接管，
 * 不看心跳年龄**（排空期间刷不出心跳是正常态；按年龄硬抢会让新旧两个进程同时执行）。
 * 早先这行断言写的是「心跳陈旧 → 接管」，那是还按年龄阈值判定的旧语义，
 * 与同一次同步进来的源码已经对不上，一直红到现在。
 */
test("WS4 重复启动：活进程一律拒绝（含心跳陈旧）；进程已死才接管", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pm-lock-"));
  process.env.PM_WORKER_LOCK_DIR = dir;
  const file = path.join(dir, "lock.json");
  const write = (pid: number, heartbeatAgoMs: number) =>
    writeFileSync(file, JSON.stringify({ workerId: "other", pid, startedAt: new Date().toISOString(), heartbeatAt: new Date(Date.now() - heartbeatAgoMs).toISOString() }));
  const origError = console.error;
  console.error = () => undefined;
  try {
    write(process.ppid, 1_000);
    assert.equal(acquireWorkerLock(), null, "另一个活着的 Worker 持锁 → 本进程不启动");
    write(process.ppid, 120_000);
    assert.equal(acquireWorkerLock(), null, "活进程 + 心跳陈旧也拒绝 —— 排空期不刷心跳，靠年龄硬抢会双跑");
    write(2_147_000_000, 1_000);
    const b = acquireWorkerLock();
    assert.ok(b, "持锁进程已不存在 → 接管");
    releaseWorkerLock(b!.workerId);
  } finally {
    console.error = origError;
    delete process.env.PM_WORKER_LOCK_DIR;
  }
});
