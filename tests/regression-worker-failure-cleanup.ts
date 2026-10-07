/**
 * R5：失败的回归不得留下任何东西 —— 且断言本身不能是空的。
 *
 * 返工记录（都是被独立验收当���抓出来的真问题）：
 *   1. 注入点在 F1，而 F1 用 ignoreLock=true，「无残留 lock.json」验的是空气；
 *   2. 改到 F7 持锁时刻后断言不空了，但每次要回放整个公平套件（25 秒）；
 *   3. 改用专用夹具后又发现：父进程按**自己**的 pid 查锁临时文件，
 *      而写锁的是子进程，残留永远查不到；父进程也只在成功尾部删目录。
 *
 * 现在的形态：专用最小夹具 `regression-worker-failure-fixture.ts` 只做三步 ——
 * 真实锁已创建 → 有一条在途执行 → 抛错；父进程有等待上限，并枚举所有
 * `lock.json.*.tmp`、按夹具写下的 org id / workerId 精确断言。
 *
 * **覆盖边界（不要夸大）**：本夹具没有 HTTP 服务、也没有真实 AgentTask，
 * 300ms 的等待也不可能跑过 10 秒的文件心跳定时器。真实 HTTP 取消、长调用期间
 * 心跳前进与退出收尾由 `tests/regression-worker-fairness.ts` 的 F5/F7 覆盖。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";

const CHILD_TIMEOUT_MS = 180_000;

async function checkFailurePath(lockDir: string): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/regression-worker-failure-fixture.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: "test",
      PM_WORKER_LOCK_DIR: lockDir,
    },
    stdio: "inherit",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const hardTimeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`失败清理回归超时（${CHILD_TIMEOUT_MS / 1000}s），子进程已强制终止`));
    }, CHILD_TIMEOUT_MS);
  });

  let code: number | null;
  try {
    code = await Promise.race([
      new Promise<number | null>((resolve) => child.on("exit", resolve)),
      hardTimeout,
    ]);
  } finally {
    clearTimeout(timer);
    // 确认子进程确实已退出：断言失败或超时时也不能把它留在后台继续动测试库。
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }

  assert.notEqual(code, 0, "注入失败必须让进程以非零退出");
  // 给操作系统一点时间回收文件句柄。
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 1) 真实锁：失败路径必须由 Worker 自己释放。
  //    夹具**不会**删这个目录（目录归本进程所有），所以这里验的是真实释放。
  assert.equal(existsSync(path.join(lockDir, "lock.json")), false, "失败运行必须释放真实文件锁");
  // 2) 锁临时文件：枚举全部 `lock.json.*.tmp`。写锁的是**子进程**，文件名带子进程
  //    pid；按父进程自己的 pid 去查等于永远查不到残留。
  const leftovers = readdirSync(lockDir).filter((name) => name.startsWith("lock.json") && name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], `不得残留锁临时文件（实际：${leftovers.join(", ") || "无"}）`);
  // 3) 本次创建的组织必须清掉（按夹具写下的 id 精确断言）。
  const orgFile = path.join(lockDir, "fixture-org");
  assert.ok(existsSync(orgFile), "夹具必须写下本次组织 id，否则清理断言无从谈起");
  const fixtureOrgId = readFileSync(orgFile, "utf8").trim();
  assert.equal(
    await prisma.organization.count({ where: { id: fixtureOrgId } }),
    0,
    "失败运行必须清理本次创建的组织"
  );
  // 4) 心跳：按夹具自己的 workerId 精确断言（不按「全表没有 stoppedAt=null」，
  //    那会连别的测试进程的历史行一起抓）。
  const workerFile = path.join(lockDir, "fixture-worker");
  assert.ok(existsSync(workerFile), "夹具必须写下本次 workerId，否则心跳断言无从谈起");
  const fixtureWorkerId = readFileSync(workerFile, "utf8").trim();
  const beat = await prisma.pmWorkerHeartbeat.findUnique({ where: { workerId: fixtureWorkerId } });
  assert.ok(beat, "夹具 worker 的心跳行必须存在");
  assert.ok(beat!.stoppedAt, "失败运行必须为该 worker 写出停止心跳");

  console.log(
    "FC1: 专用夹具持真实锁时注入失败 → 非零退出、锁与全部锁临时文件释放、停止心跳写出、夹具组织清空；父子均有等待上限"
  );
}

async function main(): Promise<void> {
  await assertTestDatabaseSafety(prisma);
  const lockDir = mkdtempSync(path.join(tmpdir(), "kern-t011-fail-"));
  try {
    await checkFailurePath(lockDir);
  } finally {
    // 成功、断言失败、超时三条路径都必须清理临时锁目录。
    rmSync(lockDir, { recursive: true, force: true });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
