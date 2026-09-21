/**
 * 测试库安全护栏 (B01-02)
 *
 * 三层校验，任一层不满足立即退出：
 *   1. 目标库名必须以 _test 结尾（库名只是第一道防护）；
 *   2. 连接角色必须是专用测试角色 TEST_DB_ROLE（默认 hermes_test），
 *      禁止用开发应用角色跑测试；
 *   3. 用测试账号实际尝试连接开发库，必须被拒绝（PostgreSQL 默认 PUBLIC 可连接，
 *      不能仅凭账号名称或库名宣称隔离完成）。
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvFiles } from "../src/shared/env";

loadEnvFiles();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\n🚨 缺少环境变量 ${name}：测试连接串必须来自环境配置，代码与 package scripts 中不得内嵌口令。\n` +
        "请在 .env 中配置后重跑（参考 .env.example，示例文件不含真实值）。\n"
    );
    process.exit(1);
  }
  return value;
}

export const TEST_DATABASE_URL = requireEnv("TEST_DATABASE_URL");
export const TEST_DB_ROLE = process.env.TEST_DB_ROLE || "hermes_test";

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

export async function assertTestDatabaseSafety(client: PrismaClient = testPrisma) {
  const result = await client.$queryRaw<Array<{ current_database: string; current_user: string }>>`
    SELECT current_database(), current_user
  `;
  const dbName = result[0]?.current_database;
  const dbUser = result[0]?.current_user;

  if (!dbName || !dbName.endsWith("_test")) {
    console.error("\n================================================================================");
    console.error(`🚨 FATAL SAFETY VIOLATION: Test suite attempted to run against non-test database: '${dbName}'!`);
    console.error("Execution blocked immediately to prevent wiping development or production data (R10)!");
    console.error("================================================================================\n");
    process.exit(1);
  }

  if (dbUser !== TEST_DB_ROLE) {
    console.error("\n================================================================================");
    console.error(`🚨 FATAL SAFETY VIOLATION: 测试连接角色为 '${dbUser}'，期望专用测试角色 '${TEST_DB_ROLE}'。`);
    console.error("禁止使用开发/生产应用角色执行测试（B01-02 账号隔离）。");
    console.error("================================================================================\n");
    process.exit(1);
  }

  // 第三层：用测试账号实际尝试连接开发库，必须失败
  const guardUrl = process.env.DEV_DATABASE_GUARD_URL;
  if (!guardUrl) {
    console.error("\n🚨 缺少 DEV_DATABASE_GUARD_URL：无法验证「测试账号无法连接开发库」，测试拒绝运行。\n");
    process.exit(1);
  }

  const devDbName = new URL(guardUrl.replace("postgresql://", "http://")).pathname.replace("/", "");
  const devUrlWithTestCreds = TEST_DATABASE_URL.replace(
    /(\/\/[^/]+\/)[^?]+/,
    `$1${devDbName}`
  );

  let devConnectionBlocked = false;
  let devError = "";
  const probe = new PrismaClient({ datasources: { db: { url: devUrlWithTestCreds } } });
  try {
    await probe.$queryRaw`SELECT 1`;
  } catch (error: any) {
    devConnectionBlocked = true;
    devError = String(error.message || error).split("\n").pop() ?? "";
  } finally {
    await probe.$disconnect().catch(() => {});
  }

  if (!devConnectionBlocked) {
    console.error("\n================================================================================");
    console.error(`🚨 FATAL SAFETY VIOLATION: 测试账号仍可连接开发库 '${devDbName}'，隔离未完成！`);
    console.error("================================================================================\n");
    process.exit(1);
  }

  console.log(
    `  🔒 测试隔离校验通过：库=${dbName} 角色=${dbUser}；测试账号连接开发库 ${devDbName} 被拒（${devError.trim().slice(0, 60)}）`
  );
}
