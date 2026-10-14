import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import {
  checkWeb, checkWorkers, collectLocalHealth, createLocalDatabase, LOCAL_WEB_URL,
  LOCAL_WORKER_LOOPS, LocalRuntimeError, pidAlive, preflightDatabase,
  printLocalHealth, readLocalWorkerLocks, reportLocalError,
} from "./local-health";

const startupLock = path.resolve(".pm-worker-local-test", "startup.json");
const children: ChildProcess[] = [];
const closedChildren = new Set<ChildProcess>();
let stopping = false;
let ownsStartupLock = false;

function stop(signal: "SIGINT" | "SIGTERM" = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === "win32" && child.pid) {
      // Next forks a server child. Kill only the process trees launched here.
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", () => child.kill(signal));
    } else child.kill(signal);
  }
}

async function acquireStartupLock(): Promise<boolean> {
  await mkdir(path.dirname(startupLock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(startupLock, "wx");
      ownsStartupLock = true;
      try { await file.writeFile(JSON.stringify({ pid: process.pid })); }
      finally { await file.close(); }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid: number };
      try { owner = JSON.parse(await readFile(startupLock, "utf8")); }
      catch { throw new LocalRuntimeError("本地启动锁正在写入或无法读取；请稍后重试。"); }
      if (pidAlive(owner.pid)) return false;
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new LocalRuntimeError("本地启动锁格式异常；请检查 .pm-worker-local-test/startup.json。");
      // Serialize stale-lock recovery too: two contenders must not unlink a
      // freshly acquired lock after both observed the same dead owner.
      const recoveryLock = `${startupLock}.recovery`;
      let recovery;
      try { recovery = await open(recoveryLock, "wx"); }
      catch { throw new LocalRuntimeError("启动锁正在恢复或恢复标记未清理；请稍后重试并检查 startup.json.recovery。"); }
      try {
        try {
          const current = JSON.parse(await readFile(startupLock, "utf8"));
          if (pidAlive(current.pid)) return false;
          if (current.pid !== owner.pid) throw new LocalRuntimeError("启动锁已变化；请稍后重试。");
          await unlink(startupLock);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } finally {
        await recovery.close();
        await unlink(recoveryLock);
      }
    }
  }
  throw new LocalRuntimeError("另一个本地启动命令正在运行；请稍后重试。");
}

async function releaseStartupLock() {
  if (!ownsStartupLock) return;
  // Never remove a lock now owned by another process.
  try {
    const owner = JSON.parse(await readFile(startupLock, "utf8"));
    if (owner.pid === process.pid) await unlink(startupLock);
  } catch { /* An absent lock needs no cleanup. */ }
  ownsStartupLock = false;
}

async function webPortAvailable(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    server.listen(3100, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve(true)));
  });
}

function launch(name: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, { stdio: "inherit", env, cwd: process.cwd() });
  children.push(child);
  child.on("error", () => { console.error(`[local] ${name} 启动失败。`); process.exitCode = 1; stop(); });
  child.on("exit", code => {
    if (!stopping) {
      console.error(`[local] ${name} 已退出（${code ?? "signal"}）。`);
      process.exitCode = code || 1;
      stop();
    }
  });
  // close also fires after a spawn error, whose exitCode can remain null.
  child.on("close", () => {
    closedChildren.add(child);
    if (children.every(item => closedChildren.has(item))) void releaseStartupLock();
  });
  return child;
}

async function main() {
  const db = createLocalDatabase();
  try {
    // Actual connection and required table reads happen before any mutation/spawn.
    const before = await preflightDatabase(db);
    console.log("[local] 数据库预检通过（连接与运行时表可读）。");
    if (!await acquireStartupLock()) {
      const health = await collectLocalHealth(db);
      printLocalHealth(health);
      if (!health.ready) throw new LocalRuntimeError("已有本地启动进程，但尚未健康；请查看原启动终端，未创建重复服务。");
      console.log("[local] 复用现有本地运行环境；本命令退出，原终端继续管理服务。");
      return;
    }

    const startWeb = await webPortAvailable();
    if (!startWeb && !(await checkWeb()).ready) {
      throw new LocalRuntimeError("3100 端口已占用，但不是就绪的 Kern 本地角色登录服务；请检查原终端，未启动重复 Web。");
    }
    const locks = await readLocalWorkerLocks();
    const existing = before.organization ? await checkWorkers(db, before.organization.id) : null;
    if (existing?.unknown || (existing?.active && !existing.ready)) {
      throw new LocalRuntimeError("已有 Worker 的组织范围未知、loop 不完整或存在重复；请检查现有 Worker，未启动新进程。");
    }
    const startWorker = !existing?.ready;
    if (startWorker && locks.length) {
      throw new LocalRuntimeError("本机已有存活的 Worker 锁，但缺少本组织完整的新鲜心跳；请检查现有 Worker，未启动重复进程。");
    }
    if (before.user && (!before.organization || before.user.organizationId !== before.organization.id || before.user.isSystem || !before.user.isActive)) {
      throw new LocalRuntimeError("保留的测试账号不符合配置，拒绝覆盖。");
    }

    const { LOCAL_TEST_EMAIL } = await import("../src/modules/identity/local-test-policy");
    await db.$transaction(async tx => {
      const org = await tx.organization.upsert({
        where: { code: before.organizationCode }, update: {},
        create: { code: before.organizationCode, name: "Kern 本地测试" },
      });
      const user = await tx.user.findUnique({ where: { email: LOCAL_TEST_EMAIL } });
      if (user) {
        if (user.organizationId !== org.id || user.isSystem || !user.isActive) throw new LocalRuntimeError("保留的测试账号不符合配置，拒绝覆盖。");
      } else {
        await tx.user.create({ data: {
          email: LOCAL_TEST_EMAIL, name: "本地测试", organizationId: org.id,
          orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } },
        } });
      }
    });
    const user = await db.user.findUniqueOrThrow({ where: { email: LOCAL_TEST_EMAIL } });
    // Setup's existing shared DB module reuses this quiet client.
    (globalThis as unknown as { prisma: typeof db }).prisma = db;
    const membership = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
      select: { role: true },
    });
    if (membership?.role === "ORG_ADMIN") {
      const { ensureWorkspaceSetup } = await import("../src/modules/workspace/setup");
      await ensureWorkspaceSetup({ userId: user.id, organizationId: user.organizationId, userEmail: user.email, userName: user.name });
    } else {
      console.log("[local] 复用现有工作区配置；测试账号没有管理员权限，跳过默认配置初始化。");
    }

    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(signal));
    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: "development", DEV_MOCK_AUTH: "false", KERN_LOCAL_TEST_LOGIN: "true",
      KERN_LOCAL_TEST_ORG_CODE: before.organizationCode, NEXT_DIST_DIR: ".next-local-test",
    };
    if (startWeb) launch("Web", ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3100"], env);
    else console.log("[local] 复用现有 Web；退出本命令不会关闭它。");
    if (startWorker) launch("Worker", ["--import", "tsx", "scripts/pm-worker.ts", `--organization-id=${user.organizationId}`, `--loops=${LOCAL_WORKER_LOOPS.join(",")}`, "--quiet"], {
      ...env, NODE_ENV: "production", PM_WORKER_LOCK_DIR: ".pm-worker-local-test",
    });
    else console.log("[local] 复用已有本组织 Worker 心跳覆盖；退出本命令不会关闭它。");

    console.log("[local] 等待 Web 登录入口与本组织全部 Worker loop 心跳（最多 120 秒）…");
    const deadline = Date.now() + 120_000;
    while (!stopping && Date.now() < deadline) {
      const web = await checkWeb();
      const workers = await checkWorkers(db, user.organizationId);
      if (web.ready && workers.ready) {
        printLocalHealth(await collectLocalHealth(db));
        console.log(`[local] 本地测试入口：${LOCAL_WEB_URL}（组织 ${before.organizationCode}）。`);
        if (children.length) console.log("[local] 保持此终端打开；Ctrl+C 关闭本命令启动的服务。");
        return;
      }
      if (workers.duplicateLoops.length || workers.unknown) throw new LocalRuntimeError("检测到重复或范围未知的 Worker；已停止本命令启动的服务。");
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    if (stopping) return;
    printLocalHealth(await collectLocalHealth(db));
    throw new LocalRuntimeError("本地服务未在 120 秒内就绪；请检查上方服务日志，已停止本命令启动的服务。");
  } finally {
    await db.$disconnect();
    if (!children.length || children.every(child => child.exitCode !== null || child.signalCode !== null)) await releaseStartupLock();
  }
}

main().catch(async error => {
  reportLocalError(error);
  process.exitCode = 1;
  stop();
  if (!children.length) await releaseStartupLock();
});
