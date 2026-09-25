/**
 * 一次性脚本：重置三个 seed 账号密码为固定值，方便本机开发登录。
 * 用法：node scripts/reset-seed-passwords.mjs [newPassword]
 *
 * 注意：hash 含 `$`，绝不能经 shell 拼接传给 psql（会被当环境变量展开），
 * 必须通过 stdin 送入。
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const NEW_PASSWORD = process.argv[2] ?? "Hermes#2026";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

const envUrl = readFileSync(".env", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length)
  .replaceAll('"', "")
  .replace("localhost", "127.0.0.1")
  .replace("?schema=public", "");

if (!envUrl) throw new Error("DATABASE_URL not found in .env");

const accounts = [
  "zhang_pm@hermes.test",
  "li_vp@hermes.test",
  "wang_eval@hermes.test",
];

const hash = hashPassword(NEW_PASSWORD);

for (const email of accounts) {
  const sql = `UPDATE "User" SET "passwordHash"='${hash}' WHERE email='${email}';\n`;
  const res = spawnSync(
    "/Applications/Postgres.app/Contents/Versions/17/bin/psql",
    [envUrl, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" }
  );
  if (res.status !== 0) {
    console.error(`FAIL ${email}:`, res.stderr);
    process.exit(1);
  }
  const m = (res.stdout || "").match(/UPDATE (\d+)/);
  console.log(`reset ${email}: ${m ? `UPDATE ${m[1]} row(s)` : res.stdout.trim()}`);
}
console.log(`new password: ${NEW_PASSWORD}`);
