/**
 * verify-migration-replay.ts（TASK-007 / TEST-003）
 *
 * 复现并验证迁移链的三条路径，全程只使用**新建的专用库**
 * （`hermes_migration_replay_*` / `hermes_migration_legacy_*`），
 * 结束后无论成败一律 DROP；绝不触碰 `hermes_next_dev` / `hermes_next_test`。
 *
 *   ① 空库完整建库：新建空库 → `prisma migrate deploy` 必须 exit 0（9 个迁移全部落账），
 *      且 `migrate diff --from-url <库> --to-schema-datamodel` 必须无差异。
 *   ② 已知历史库升级：新建专用库 → 账本补录前 5 个迁移 + 用当前迁移 SQL 重建其结构
 *      （作为 db push 时期 legacy 库的**近似重建**；真实 legacy 库已无快照，这是本路径
 *      的可复现上限，如实记录）→ **补基线账本前**先与「链上前 6 个迁移 deploy 出的
 *      参考库」做库对库 diff 验证完整结构（不一致即拒绝补账本，见 ②b 负例）→
 *      仅 `resolve --applied` 补基线账本 → `migrate deploy` 必须只补跑
 *      20260913220000 / 20260916010000 / 20260919010000，且**不**重跑基线 →
 *      结构 diff 必须无差异。
 *   ③ 当前库形态无操作重放：新建专用库先 deploy 全链，再重复
 *      `migrate status` / `migrate deploy` → status 必须 “up to date”、
 *      deploy 必须 “No pending migrations to apply.”（幂等）。
 *
 * 管理连接（CREATE/DROP DATABASE）使用 superuser（默认当前 macOS 用户，可被
 * PGADMIN_USER 覆盖）；专用库 owner 沿用 `DATABASE_URL` 中的应用账号，
 * 迁移以该应用账号执行——与真实部署同口径。
 *
 * 运行：`NODE_OPTIONS= ./node_modules/.bin/tsx scripts/verify-migration-replay.ts`
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles } from "../src/shared/env";

loadEnvFiles();

const DATABASE_URL = process.env.DATABASE_URL;
const PG_BIN = process.env.PG_BIN || "/Applications/Postgres.app/Contents/Versions/17/bin";
const PGADMIN_USER = process.env.PGADMIN_USER || process.env.USER;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required (see .env)");
if (!PGADMIN_USER) throw new Error("PGADMIN_USER (superuser) is required");

const base = new URL(DATABASE_URL);
const appUser = decodeURIComponent(base.username);
const appPassword = decodeURIComponent(base.password);
const host = base.hostname;
const port = base.port || "5432";

const ADMIN_DB = "hermes_next_dev"; // 只用作管理连接目标，**绝不写入**
const REPLAY_PREFIX = "hermes_migration_replay_";
const LEGACY_PREFIX = "hermes_migration_legacy_";

function appUrl(dbName: string): string {
  return `postgresql://${encodeURIComponent(appUser)}:${encodeURIComponent(appPassword)}@${host}:${port}/${dbName}?schema=public`;
}

function adminSql(sql: string): void {
  execFileSync(`${PG_BIN}/psql`, ["-h", host, "-p", port, "-U", PGADMIN_USER!, "-d", ADMIN_DB, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: ["ignore", "pipe", "inherit"] });
}

function adminQueryOn(db: string, sql: string): string {
  return execFileSync(`${PG_BIN}/psql`, ["-h", host, "-p", port, "-U", PGADMIN_USER!, "-d", db, "-t", "-A", "-c", sql], { encoding: "utf8" }).trim();
}

const prismaBin = "./node_modules/.bin/prisma";
function prisma(args: string[], url: string): { status: number; out: string } {
  const res = spawnSync(prismaBin, args, { encoding: "utf8", env: { ...process.env, DATABASE_URL: url } });
  return { status: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const created: string[] = [];
function createScratch(prefix: string): string {
  const name = `${prefix}${Date.now()}`;
  adminSql(`CREATE DATABASE "${name}" OWNER ${appUser}`);
  created.push(name);
  return name;
}

function dropScratch(): void {
  for (const name of created.splice(0)) {
    try {
      adminSql(`DROP DATABASE IF EXISTS "${name}"`);
      console.log(`  🧹 dropped ${name}`);
    } catch (e) {
      console.error(`  ⚠️ DROP 失败（${name}）：${e}`);
      process.exitCode = 1;
    }
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

const MIGRATIONS_DIR = "prisma/migrations";
const ledgerOrder = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(MIGRATIONS_DIR, d.name, "migration.sql")))
  .map((d) => d.name)
  .sort();
const BASELINE = "20260913120000_add_signal_research_run_baseline";
const baselineIdx = ledgerOrder.indexOf(BASELINE);
assert(baselineIdx > 0, `迁移目录中应存在 ${BASELINE} 且非首个`);

// ---------------------------------------------------------------------------
// 路径①：空库完整建库
// ---------------------------------------------------------------------------
function pathFresh(): void {
  console.log("\n== ① 空库完整建库 ==");
  const db = createScratch(REPLAY_PREFIX);
  const url = appUrl(db);
  const deploy = prisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"], url);
  assert(deploy.status === 0, `空库 migrate deploy 应 exit 0，实际 ${deploy.status}：\n${deploy.out.slice(-2000)}`);
  console.log(`  ✅ migrate deploy exit 0（${ledgerOrder.length} 个迁移全部落账）`);

  const failed = adminQueryOn(db, `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`);
  assert(failed === "", `不应存在失败/未完成迁移，实际：${failed}`);
  console.log("  ✅ 账本无失败/未完成迁移");

  const diff = prisma(["migrate", "diff", "--from-url", url.replace(/\?.*$/, ""), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], url);
  assert(diff.status === 0, `空库重放结果与 schema.prisma 应无差异：\n${diff.out.slice(-2000)}`);
  console.log("  ✅ migrate diff（重放库 vs schema.prisma）无差异");
}

/** 用迁移 SQL 在 db 内重建给定迁移序列的结构（近似 db push 时期的 legacy 终态）。 */
function reconstructStructure(db: string, migrations: string[], extraSql = ""): void {
  const work = join(tmpdir(), `verify-migration-replay-${process.pid}-${db}`);
  mkdirSync(work, { recursive: true });
  const concat = join(work, "reconstruct.sql");
  const sql = migrations.map((m) => readFileSync(join(MIGRATIONS_DIR, m, "migration.sql"), "utf8")).join("\n") + extraSql;
  writeFileSync(concat, sql);
  execFileSync(`${PG_BIN}/psql`, ["-h", host, "-p", port, "-U", appUser, "-d", db, "-v", "ON_ERROR_STOP=1", "-f", concat], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, PGPASSWORD: appPassword },
  });
  rmSync(work, { recursive: true, force: true });
}

/** 参考库：临时目录只放链上前 baselineIdx+1 个迁移并真实 deploy，得到「基线落账后」的链上标准结构。 */
function buildReferenceDb(): { db: string; url: string } {
  const db = createScratch(REPLAY_PREFIX);
  const url = appUrl(db);
  const work = join(tmpdir(), `verify-migration-replay-ref-${process.pid}-${db}`);
  const out = join(work, "migrations");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(work, "schema.prisma"), readFileSync("prisma/schema.prisma", "utf8"));
  for (const m of ledgerOrder.slice(0, baselineIdx + 1)) {
    mkdirSync(join(out, m), { recursive: true });
    writeFileSync(join(out, m, "migration.sql"), readFileSync(join(MIGRATIONS_DIR, m, "migration.sql"), "utf8"));
  }
  const deploy = prisma(["migrate", "deploy", "--schema", join(work, "schema.prisma")], url);
  rmSync(work, { recursive: true, force: true });
  assert(deploy.status === 0, `参考库 deploy（链上前 ${baselineIdx + 1} 个迁移）应 exit 0：\n${deploy.out.slice(-1500)}`);
  return { db, url };
}

const bare = (u: string) => u.replace(/\?.*$/, "");
const diffDb = (fromUrl: string, toUrl: string) =>
  prisma(["migrate", "diff", "--from-url", bare(fromUrl), "--to-url", bare(toUrl), "--exit-code"], fromUrl);

/** 补录迁移账本（仅账本，不执行 DDL）。 */
function resolveApplied(url: string, migrations: string[]): void {
  for (const m of migrations) {
    const r = prisma(["migrate", "resolve", "--applied", m, "--schema", "prisma/schema.prisma"], url);
    assert(r.status === 0, `resolve --applied ${m} 应成功：\n${r.out.slice(-1000)}`);
  }
}

// ---------------------------------------------------------------------------
// 路径②：已知历史库升级（legacy 近似重建 + 补账本前结构核验）
// ---------------------------------------------------------------------------
function pathLegacy(): void {
  console.log("\n== ② 已知历史库升级（legacy 近似重建 + 补账本前结构核验） ==");
  const db = createScratch(LEGACY_PREFIX);
  const url = appUrl(db);
  const preBaseline = ledgerOrder.slice(0, baselineIdx); // 0_init … 20260913090000（5 个）
  const postBaseline = ledgerOrder.slice(baselineIdx + 1); // 20260913220000 / 20260916010000 / 20260919010000

  resolveApplied(url, preBaseline); // 模拟 legacy 库已有的迁移账本
  console.log(`  ✅ 账本补录前 ${preBaseline.length} 个迁移（模拟 legacy 账本）`);

  // 真实 legacy 库已无 schema 快照，这是本路径的可复现上限（如实记录）
  reconstructStructure(db, [...preBaseline, BASELINE]);
  console.log(`  ✅ 结构重建：前 ${preBaseline.length} 个迁移 + ${BASELINE}（近似 legacy 终态）`);

  // 计划要求「先验证对应完整结构，再仅补该迁移账本」：与链上参考库做库对库 diff
  const ref = buildReferenceDb();
  const structCheck = diffDb(url, ref.url);
  assert(structCheck.status === 0, `补账本前结构核验失败（legacy ≠ 链上基线参考库），按计划拒绝补账本：\n${structCheck.out.slice(-2000)}`);
  console.log("  ✅ 补账本前结构核验通过（与链上基线参考库 diff 无差异）");

  resolveApplied(url, [BASELINE]); // 仅补账本，不执行 DDL
  console.log(`  ✅ 仅补基线账本：resolve --applied ${BASELINE}（不执行 DDL）`);

  const deploy = prisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"], url);
  assert(deploy.status === 0, `legacy 升级 deploy 应 exit 0，实际 ${deploy.status}：\n${deploy.out.slice(-2000)}`);
  for (const m of postBaseline) {
    assert(deploy.out.includes(`Applying migration \`${m}\``), `应补跑 ${m}`);
  }
  assert(!deploy.out.includes(`Applying migration \`${BASELINE}\``), `不得重跑 ${BASELINE}（其结构已由 legacy 历史承载）`);
  console.log(`  ✅ deploy 只补跑 ${postBaseline.length} 个后续迁移，未重跑基线（账本一致）`);

  const diff = prisma(["migrate", "diff", "--from-url", bare(url), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], url);
  assert(diff.status === 0, `legacy 升级结果与 schema.prisma 应无差异：\n${diff.out.slice(-2000)}`);
  console.log("  ✅ migrate diff（升级库 vs schema.prisma）无差异");
}

// ---------------------------------------------------------------------------
// 路径②b 负例：结构部分匹配 → 必须拒绝补基线账本
// ---------------------------------------------------------------------------
function pathLegacyPartialRefusal(): void {
  console.log("\n== ②b 负例：部分匹配（仅空 SignalItem）必须拒绝补基线账本 ==");
  const db = createScratch(LEGACY_PREFIX);
  const url = appUrl(db);
  resolveApplied(url, ledgerOrder.slice(0, baselineIdx));
  reconstructStructure(db, ledgerOrder.slice(0, baselineIdx), `\nCREATE TABLE "SignalItem" ("id" TEXT NOT NULL, CONSTRAINT "SignalItem_pkey" PRIMARY KEY ("id"));\n`);
  const structCheck = diffDb(url, buildReferenceDb().url);
  assert(structCheck.status !== 0, "部分匹配库不应通过结构核验（预期拒绝，实际通过）");
  console.log("  ✅ 部分匹配库被结构核验拒绝（diff 非 0），按计划不补账本、不 deploy");
}

// ---------------------------------------------------------------------------
// 路径③：当前库形态无操作重放（幂等）
// ---------------------------------------------------------------------------
function pathIdempotent(): void {
  console.log("\n== ③ 当前库形态无操作重放（幂等） ==");
  const db = createScratch(REPLAY_PREFIX);
  const url = appUrl(db);
  const first = prisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"], url);
  assert(first.status === 0, `首次 deploy 应 exit 0：\n${first.out.slice(-1000)}`);

  const status = prisma(["migrate", "status", "--schema", "prisma/schema.prisma"], url);
  assert(status.out.includes("Database schema is up to date"), `migrate status 应为 up to date：\n${status.out.slice(-1000)}`);
  const again = prisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"], url);
  assert(again.status === 0 && again.out.includes("No pending migrations to apply"), `重放 deploy 应无 pending：\n${again.out.slice(-1000)}`);
  console.log("  ✅ migrate status = up to date；重放 deploy = No pending migrations to apply.");
}

// ---------------------------------------------------------------------------
try {
  // 防御：目标库名前缀固定，且绝不等于既有库
  for (const name of [REPLAY_PREFIX, LEGACY_PREFIX]) {
    assert(!name.includes("hermes_next_dev") && !name.includes("hermes_next_test"), "专用库前缀不得与既有库冲突");
  }
  pathFresh();
  pathLegacy();
  pathLegacyPartialRefusal();
  pathIdempotent();
  console.log("\n✅ 四条迁移路径全部通过（① 空库建库 ② legacy 升级 ②b 部分匹配拒绝 ③ 幂等重放）");
} finally {
  dropScratch();
}
