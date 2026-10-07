import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { localBin } from "../scripts/lib/local-bin";
import { verifyStructureMatchesSchema } from "../scripts/prepare-test-database-verify";
import { loadEnvFiles } from "../src/shared/env";

// 真实工具段（V7-V10）要靠 prisma 解析 schema，而 schema 的 datasource 是
// env("DATABASE_URL")：不先加载 .env 会让 diff 因「环境变量缺失」exit 1，
// 那样 V7/V9 测到的就不是「0 与 1 真实存在」，而是「没配环境」。
loadEnvFiles();

/**
 * 回归：TASK-004「有账本 ≠ 结构正确」。
 *
 * prepare-test-database.ts 的 `structure-unverified` 是**拒绝**状态，不是提示。
 * 它的判据是 `prisma migrate diff --exit-code` 的退出码：
 *   0 = 结构一致 → managed；2 = 有漂移 → 拒绝；其它（1/null）= 工具或连接出错 → 拒绝。
 *
 * 最危险的回归是把判据从「必须 0」放宽成「0 或 2 都算过」：测试库一旦与 schema 漂移，
 * 脚本会照样报 managed，随后 migrate deploy 把账本补齐——**漂移被永久掩盖**，
 * 而 acc-server/acc-llm-e2e 的所有下游断言都建立在「库结构正确」这个前提上。
 *
 * 因此本文件分三段钉死：
 *   V1-V6  退出码解读（注入 runner，直接喂 0/1/2/null/异常）
 *   V7-V10 真实工具确实产生这些退出码（不是凭空假设）
 *   V11    getState 的接线：structure-unverified 只由 !verdict.ok 触发，且判据没有被放宽
 */

/** 造一份会被判为「有漂移」的 schema：比原 schema 多一张表。 */
function makeTamperedSchema(): { dir: string; pristine: string; tampered: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kern-struct-"));
  const pristine = path.join(dir, "pristine.prisma");
  const tampered = path.join(dir, "tampered.prisma");
  const src = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf8");
  fs.writeFileSync(pristine, src, "utf8");
  fs.writeFileSync(tampered, `${src}\nmodel DriftProbe {\n  id String @id @default(uuid())\n}\n`, "utf8");
  return { dir, pristine, tampered };
}

function runDiff(args: readonly string[]): number | null {
  // 必须带 `migrate diff`：少了子命令 prisma 会打印 usage 并 exit 1，
  // 那样 V7/V9 测到的都是「我调错了命令」，而不是 0/1/2 的语义。
  const [cmd, cmdArgs] = localBin("prisma", ["migrate", "diff", ...args, "--exit-code"]);
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  assert.equal(res.error, undefined, String(res.error));
  return res.status;
}

// ---------- V1-V6：退出码解读 ----------

test("V1：exit 0（结构一致）→ 判为已验证，这是唯一能给出 managed 的退出码", () => {
  const verdict = verifyStructureMatchesSchema("postgresql://x/y", () => ({ status: 0 }));
  assert.equal(verdict.ok, true);
});

test("V2：exit 2（实库与 schema 有漂移）→ 必须拒绝，绝不能判 managed", () => {
  const verdict = verifyStructureMatchesSchema("postgresql://x/y", () => ({
    status: 2,
    stdout: "- model Artifact\n",
    stderr: "",
  }));
  assert.equal(verdict.ok, false, "有漂移却判 ok，等于把『有账本』当『结构正确』");
});

test("V3：exit 1（工具或连接出错）→ 同样拒绝：未验证 ≠ 已验证", () => {
  assert.equal(verifyStructureMatchesSchema("postgresql://x/y", () => ({ status: 1 })).ok, false);
});

test("V4：进程没起来（status null + error）→ 拒绝，且 detail 说明原因而不是留空", () => {
  const verdict = verifyStructureMatchesSchema("postgresql://x/y", () => ({
    status: null,
    error: new Error("spawn ENOENT"),
  }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /无法运行 prisma/, "报错必须指名，不能只说一句空的『结构未通过』");
  assert.match(verdict.detail, /ENOENT/);
});

test("V5：stdout/stderr 要进 detail，.sh 才能把差异摆给人看", () => {
  const verdict = verifyStructureMatchesSchema("postgresql://x/y", () => ({
    status: 2,
    stdout: "+ model DriftProbe\n",
    stderr: "drift found\n",
  }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /DriftProbe/);
  assert.match(verdict.detail, /drift found/);
});

test("V6：runner 自己抛异常也算未验证，不得冒泡成一次不带结论的崩溃", () => {
  const verdict = verifyStructureMatchesSchema("postgresql://x/y", () => {
    throw new Error("本地 prisma 入口缺失");
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /本地 prisma 入口缺失/);
});

// ---------- V7-V10：真实工具确实产生这些退出码 ----------

test("V7：真实 prisma 对同一份 schema 判 exit 0（工具可用，0 真实存在）", () => {
  const { dir, pristine } = makeTamperedSchema();
  try {
    assert.equal(runDiff(["--from-schema-datamodel", pristine, "--to-schema-datamodel", pristine]), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("V8：加一张表后真实 prisma 判 exit 2（漂移确实被检出，2 真实存在）", () => {
  const { dir, pristine, tampered } = makeTamperedSchema();
  try {
    assert.equal(
      runDiff(["--from-schema-datamodel", pristine, "--to-schema-datamodel", tampered]),
      2,
      "若这里不再是 2，V2/V3 喂的退出码就脱离了真实工具的行为"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("V9：连不上的库 → 真实 prisma 判 exit 1（非 0 情形真实存在，V3 不是臆造）", () => {
  assert.equal(
    runDiff(["--from-url", "postgresql://kern_no_such_user:kern_bad@127.0.0.1:1/kern_no_such_db", "--to-schema-datamodel", "prisma/schema.prisma"]),
    1
  );
});

test("V10：真库 vs schema 必须给出裁决（0 或 2），不得是 1/null 这种无结论失败", () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "TEST_DATABASE_URL 未定义");
  const status = runDiff(["--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma"]);
  assert.ok(
    status === 0 || status === 2,
    `结构比对没有给出裁决（exit=${status}）：要么 prisma 入口坏了，要么库连不上；` +
      "两种都会让 prepare-test-database 永远卡在 structure-unverified，从而把 acc-* 全线阻断"
  );
});

// ---------- V11：接线契约 ----------

test("V11：structure-unverified 只由 !verdict.ok 触发，且判据没有被放宽成 0 或 2", () => {
  const script = fs.readFileSync("scripts/prepare-test-database.ts", "utf8");
  const verify = fs.readFileSync("scripts/prepare-test-database-verify.ts", "utf8");

  assert.match(
    script,
    /if \(!verdict\.ok\) \{\s*\n[\s\S]{0,400}?return "structure-unverified";/,
    "getState 必须在 verdict 未通过时返回 structure-unverified"
  );
  assert.match(
    verify,
    /ok: res\.status === 0,/,
    "判据必须是 status === 0；放宽成 `=== 0 || === 2` 会让漂移被判为 managed"
  );
  assert.doesNotMatch(
    verify,
    /status\s*===\s*0\s*\|\|/,
    "检测到 0/2 合取：漂移会被判成已验证，这是本文件要防的那条回归"
  );
});
