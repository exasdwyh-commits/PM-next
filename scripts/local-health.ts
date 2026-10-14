import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

export const LOCAL_WEB_URL = "http://127.0.0.1:3100/login";
export const LOCAL_WORKER_LOOPS = ["conversation", "executor", "research", "event", "reconcile", "schedule", "knowledge"] as const;
const STALE_MS = 90_000; // Same freshness contract as modules/worker/heartbeat.ts.

export class LocalRuntimeError extends Error {}

export function createLocalDatabase(): PrismaClient {
  // Match Next development: .env.development.local / .env.local precede .env.
  loadEnvConfig(process.cwd(), true);
  if (!process.env.DATABASE_URL) {
    throw new LocalRuntimeError("未配置 DATABASE_URL；请检查 .env 或当前进程环境。");
  }
  // Never echo connection strings, Prisma error bodies, or query parameters.
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: [] });
}

export async function preflightDatabase(db: PrismaClient) {
  const { LOCAL_TEST_ORG, LOCAL_TEST_EMAIL } = await import("../src/modules/identity/local-test-policy");
  try {
    await db.$queryRaw`SELECT 1`;
    const organization = await db.organization.findUnique({ where: { code: LOCAL_TEST_ORG }, select: { id: true, code: true } });
    const user = await db.user.findUnique({ where: { email: LOCAL_TEST_EMAIL }, select: { id: true, organizationId: true, isSystem: true, isActive: true } });
    // Verify the heartbeat schema before startup creates any workspace records.
    await db.pmWorkerHeartbeat.findFirst({ select: { organizationId: true, scopeKnown: true, loops: true, heartbeatAt: true, stoppedAt: true } });
    return { organization, user, organizationCode: LOCAL_TEST_ORG };
  } catch {
    throw new LocalRuntimeError("数据库连接或运行时表检查失败；请检查数据库服务、DATABASE_URL 和迁移状态（未执行自动迁移）。");
  }
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export async function readLocalWorkerLocks() {
  const dirs = new Set([".pm-worker", ".pm-worker-local-test", process.env.PM_WORKER_LOCK_DIR].filter((dir): dir is string => !!dir));
  const locks: { directory: string; pid: number }[] = [];
  for (const directory of dirs) {
    try {
      const lock = JSON.parse(await readFile(path.resolve(directory, "lock.json"), "utf8"));
      if (!Number.isInteger(lock?.pid) || lock.pid <= 0) throw new Error("Invalid worker lock");
      if (pidAlive(lock.pid)) locks.push({ directory, pid: lock.pid });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new LocalRuntimeError("无法读取本机 Worker 锁；请检查锁文件格式和读取权限。");
      }
    }
  }
  return locks;
}

export async function checkWeb(timeoutMs = 5_000) {
  try {
    const response = await fetch(LOCAL_WEB_URL, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      return { ready: false, detail: `登录端点 HTTP ${response.status}，尚未就绪或端口属于其他服务。` };
    }
    const body = await response.text();
    // GET only: no login/session creation, and no authentication bypass.
    const ready = body.includes("kx-login") && body.includes("kx-role-entry");
    return { ready, detail: ready ? "HTTP 200，本地角色登录入口可用。" : "HTTP 200，但未识别到 Kern 本地角色登录入口。" };
  } catch {
    return { ready: false, detail: "无法访问本地登录端点（未启动、编译中或请求超时）。" };
  }
}

export async function checkWorkers(db: PrismaClient, organizationId: string) {
  const now = Date.now();
  const rows = await db.pmWorkerHeartbeat.findMany({
    where: { OR: [{ organizationId }, { organizationId: null }, { scopeKnown: false }] },
    select: { organizationId: true, scopeKnown: true, pid: true, host: true, loops: true, heartbeatAt: true, stoppedAt: true },
    orderBy: { heartbeatAt: "desc" },
  });
  // A heartbeat from this host must also have a live PID. Other hosts use freshness.
  const active = rows.filter(row => !row.stoppedAt && now - row.heartbeatAt.getTime() < STALE_MS && (row.host !== os.hostname() || pidAlive(row.pid)));
  const known = active.filter(row => row.scopeKnown && (row.organizationId === null || row.organizationId === organizationId));
  const unknown = active.filter(row => !row.scopeKnown);
  const loops = LOCAL_WORKER_LOOPS.map(loop => {
    const covering = known.filter(row => Array.isArray(row.loops) && row.loops.includes(loop));
    return { loop, running: covering.length, heartbeatAt: covering[0]?.heartbeatAt.toISOString() ?? null };
  });
  const duplicateLoops = loops.filter(loop => loop.running > 1).map(loop => loop.loop);
  const ready = loops.every(loop => loop.running === 1) && unknown.length === 0;
  return { ready, active: known.length, unknown: unknown.length, loops, duplicateLoops };
}

export async function collectLocalHealth(db: PrismaClient) {
  const database = await preflightDatabase(db);
  const web = await checkWeb();
  const workers = database.organization ? await checkWorkers(db, database.organization.id) : null;
  const workspaceReady = !!database.organization && !!database.user && database.user.isActive && !database.user.isSystem && database.user.organizationId === database.organization.id;
  return { database, workspaceReady, web, workers, ready: workspaceReady && web.ready && !!workers?.ready };
}

export function printLocalHealth(health: Awaited<ReturnType<typeof collectLocalHealth>>) {
  console.log("[local-health] 数据库：SELECT 1 与运行时表读取成功。");
  console.log(`[local-health] 测试工作区：${health.database.organizationCode}，${health.workspaceReady ? "账号与组织匹配" : "组织/账号缺失或配置不匹配"}。`);
  console.log(`[local-health] Web：${LOCAL_WEB_URL} — ${health.web.detail}`);
  if (health.workers) {
    console.log("[local-health] Worker：仅计入已知组织范围（本组织或全组织）的新鲜心跳；本机同时检查 PID。");
    for (const loop of health.workers.loops) {
      console.log(`  ${loop.loop}: ${loop.running === 1 ? "running" : loop.running > 1 ? "duplicate" : "missing/stale/stopped"}${loop.heartbeatAt ? `，心跳 ${loop.heartbeatAt}` : ""}`);
    }
    if (health.workers.unknown) console.log("[local-health] 存在范围未知的活跃 Worker，无法确认是否重复执行。");
  } else console.log("[local-health] Worker：测试组织不存在，无法检查组织范围。");
  console.log(`[local-health] ${health.ready ? "本地运行环境已就绪。" : "本地运行环境未就绪；可运行 npm run dev:local，按提示处理冲突。"}`);
}

export function reportLocalError(error: unknown) {
  console.error(`[local] ${error instanceof LocalRuntimeError ? error.message : "运行时检查失败；请检查数据库、端口和文件权限。详细错误未输出，以免泄露凭据。"}`);
}

// Importing from local-test does not execute the read-only CLI.
if (process.argv[1] && /(?:^|[\\/])local-health\.(?:ts|js)$/.test(process.argv[1])) {
  let db: PrismaClient | undefined;
  (async () => {
    db = createLocalDatabase();
    const health = await collectLocalHealth(db);
    printLocalHealth(health);
    process.exitCode = health.ready ? 0 : 1;
  })().catch(error => { reportLocalError(error); process.exitCode = 1; })
    .finally(async () => { await db?.$disconnect(); });
}
