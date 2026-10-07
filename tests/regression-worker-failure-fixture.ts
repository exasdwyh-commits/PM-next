/**
 * R5 专用失败夹具：**最小**地制造一次「持真实锁、仍在途、然后失败」。
 *
 * 之前的失败清理回归靠在公平套件里注入失败来回放整个套件（25 秒、几十个组织），
 * 既慢又耦合。这里只保留真正要验证的那一段机制：
 *   真实文件锁已创建 → 有一条在途执行 → 此刻抛错。
 * 父进程（tests/regression-worker-failure-cleanup.ts）据此断言锁、心跳、
 * 端口、子进程与本次夹具全部收干净。
 *
 * 本文件由 tests/regression-worker-failure-cleanup.ts 以子进程方式运行，
 * 不是一个独立测试入口。
 */
import { existsSync, writeFileSync } from "node:fs";
import prisma from "../src/shared/db";
import { runPmWorker } from "../src/modules/supervisor/worker-runtime";
import { PROCESS_WORKER_ID } from "../src/modules/worker/heartbeat";
import { workerHandlers } from "../src/modules/worker/registry";
import { drainInFlight, trackInFlight } from "../src/modules/worker/scheduler";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function waitFor(check: () => Promise<boolean>, label: string, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture timeout: ${label}`);
}

async function main() {
  const lockDir = process.env.PM_WORKER_LOCK_DIR;
  if (!lockDir) throw new Error("PM_WORKER_LOCK_DIR is required");
  const org = await prisma.organization.create({ data: { code: `t011fail-${Date.now()}`, name: "TASK-011 failure fixture" } });
  // 把本次的组织 id 交给父进程：断言必须针对**这一次**的 id，
  // 否则上一轮遗留的孤儿组织会让断言永久变红（或让它悄悄失去意义）。
  writeFileSync(`${lockDir}/fixture-org`, org.id, "utf8");
  writeFileSync(`${lockDir}/fixture-worker`, PROCESS_WORKER_ID, "utf8");
  const handlers = workerHandlers();
  const originalTick = handlers.conversations?.runPendingTick;
  const pending = gate();
  let inFlight = 0;
  let worker: Promise<unknown> | null = null;
  const controller = new AbortController();

  try {
    // 让本进程持有的执行永远不结束：排空必须等它，直到 finally 里放开门。
    handlers.conversations!.runPendingTick = async () => {
      inFlight += 1;
      trackInFlight(pending.promise);
      return { scanned: 1, acted: 1, skipped: 0, errors: 0 };
    };
    worker = runPmWorker({ loops: ["conversation"], quiet: false, intervals: { conversation: 100 }, signal: controller.signal });
    await waitFor(async () => inFlight > 0, "tick launched with tracked in-flight work");
    await waitFor(async () => existsSync(`${lockDir}/lock.json`), "real lock file created");
    // 让心跳定时器跑过一次真实写入，确保锁确实在被使用。
    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log("[fixture] 真实锁已创建且存在在途执行，此刻注入失败");
    throw new Error("injected failure while holding the real worker lock");
  } finally {
    // 放开门 → Worker 自己走完收尾：锁删除、心跳停止标记都必须由它写出来。
    // **这里绝不删锁目录** —— 目录归父进程所有；夹具自己删掉它，
    // 父进程就再也分不清「Worker 释放了锁」和「目录被整个删了」。
    pending.release();
    // 常驻 Worker 不会自己结束：不发停止信号就会一直轮询，父进程只能靠硬超时杀它。
    // 先停领取，再等它把在途执行排空。
    controller.abort();
    if (worker) await worker.catch(() => undefined);
    await drainInFlight().catch(() => undefined);
    if (originalTick) handlers.conversations!.runPendingTick = originalTick;
    try {
      await prisma.organization.deleteMany({ where: { id: org.id } });
    } catch (error) {
      console.error("[fixture] 组织清理失败：", error instanceof Error ? error.message : error);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
