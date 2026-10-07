import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFiles } from "../src/shared/env";
import { verifyStructureMatchesSchema } from "./prepare-test-database-verify";

loadEnvFiles();

const url = process.env.TEST_DATABASE_URL;
const role = process.env.TEST_DB_ROLE || "hermes_test";
if (!url) throw new Error("TEST_DATABASE_URL is required");

const prisma = new PrismaClient({ datasources: { db: { url } } });

/**
 * 测试库状态。
 *
 * 4b 加固新增两个「拒绝」状态（此前会把它们误判为 `managed`）：
 *   - `failed-migrations`：账本存在但**含失败/未完成迁移**（`finished_at IS NULL` / `rolled_back_at IS NOT NULL`）。
 *   - `structure-unverified`：账本齐全，但**实库结构与 `schema.prisma` 不一致**（结构比对未通过）。
 *
 * 硬约束（对应计划 TASK-004）：**「有账本」不得被当作「结构正确」**；
 * 比对做不到时宁可输出 `structure-unverified`，**绝不**谎报 `managed`。
 */
type SchemaState =
  | "legacy-untracked"
  | "managed"
  | "current"
  | "failed-migrations"
  | "structure-unverified"
  | "pending";

/** 迁移目录（磁盘）中的迁移名，按字典序 —— 与 prisma 的应用顺序一致。 */
const MIGRATIONS_DIR = "prisma/migrations";
function listOnDiskMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(MIGRATIONS_DIR, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();
}

// 结构比对实现见 ./prepare-test-database-verify.ts（退出码 0/2/非0 的解读是
// TASK-004 的核心不变量，抽成可注入依赖的纯函数以便被回归测试直接喂 0/1/2/null）。

async function getState(): Promise<SchemaState> {
  const identity = await prisma.$queryRaw<Array<{ database: string; user: string }>>`
    SELECT current_database() AS database, current_user AS user
  `;
  const database = identity[0]?.database;
  const user = identity[0]?.user;
  if (!database?.endsWith("_test") || user !== role) {
    throw new Error(`Refusing database preparation: expected ${role} on a *_test database, got ${user} on ${database}`);
  }

  const [migrationTable] = await prisma.$queryRaw<Array<{ name: string | null }>>`
    SELECT to_regclass('_prisma_migrations')::text AS name
  `;
  if (migrationTable?.name) {
    // 4b：账本存在 ≠ 结构正确。① 先查失败/未完成迁移（有则拒绝，并报出具体迁移名）。
    const bad = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
      ORDER BY started_at
    `;
    if (bad.length > 0) {
      process.stderr.write(
        `检测到 ${bad.length} 条失败/未完成迁移：${bad.map((b) => b.migration_name).join(", ")}\n`
      );
      return "failed-migrations";
    }
    // ② 账本齐全 + 存在**待应用迁移** → 正常前进（结构差异正是这些迁移造成的，
    //    交由 .sh 执行 deploy，deploy 之后再按「结构必须与 schema 一致」收口）。
    //    若不区分这一步，任何新增迁移都会先被误判成 structure-unverified → 死锁。
    const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const appliedNames = new Set(applied.map((a) => a.migration_name));
    const pending = listOnDiskMigrations().filter((m) => !appliedNames.has(m));
    if (pending.length > 0) return "pending";

    // ③ 无 pending 后再做「期望对象 vs 实库对象」结构比对；不一致则拒绝，绝不谎报 managed。
    const verdict = verifyStructureMatchesSchema(url!);
    if (!verdict.ok) {
      process.stderr.write(`结构比对未通过（实库与 schema.prisma 不一致）：\n${verdict.detail}\n`);
      return "structure-unverified";
    }
    return "managed";
  }

  const facts = await prisma.$queryRaw<Array<{ artifact_fields: bigint; org_member_table: boolean; signal_nullable: string | null; llm_enum: bigint }>>`
    SELECT
      (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'Artifact'
         AND column_name IN ('organizationId', 'productVersionId', 'schemaVersion')) AS artifact_fields,
      to_regclass('"OrganizationMember"') IS NOT NULL AS org_member_table,
      (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'SignalItem' AND column_name = 'organizationId') AS signal_nullable,
      (SELECT count(*) FROM pg_enum WHERE enumtypid = '"RunMode"'::regtype AND enumlabel = 'LLM') AS llm_enum
  `;
  const fact = facts[0];
  if (fact?.artifact_fields === BigInt(0) && !fact.org_member_table && fact.signal_nullable === "YES" && fact.llm_enum === BigInt(0)) {
    return "legacy-untracked";
  }
  if (fact?.artifact_fields === BigInt(3) && fact.org_member_table && fact.signal_nullable === "NO" && fact.llm_enum === BigInt(1)) {
    return "current";
  }
  throw new Error("Test database has no migration ledger and does not match the verified legacy baseline. Refusing to guess its history.");
}

getState()
  .then((state) => process.stdout.write(`${state}\n`))
  .finally(() => prisma.$disconnect());
