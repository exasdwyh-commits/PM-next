import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { localBin } from "../scripts/lib/local-bin";

/**
 * 回归：测试基建在 Windows 上 spawn `./node_modules/.bin/prisma` 得到 ENOENT（status null、输出为空），
 * prepare-test-database 因此误报「实库与 schema 不一致」，acc-server 拒绝启动，约 10 个验收套件被连带阻断。
 * localBin 必须返回「当前 node + 包 JS 入口」，且真的能跑起来。
 */
test("LB1：localBin 用当前 node 执行包入口，而不是 .bin 下的 shell 脚本", () => {
  for (const name of ["prisma", "tsx"] as const) {
    const [cmd, args] = localBin(name, ["--version"]);
    assert.equal(cmd, process.execPath);
    assert.ok(fs.existsSync(args[0]), `${name} 入口应存在：${args[0]}`);
    assert.ok(!args[0].includes(`${path.sep}.bin${path.sep}`), "不得指向 node_modules/.bin");
    assert.equal(args.at(-1), "--version");
  }
});

test("LB2：prisma 通过 localBin 真实启动（status 0，而不是 ENOENT/null）", () => {
  const [cmd, args] = localBin("prisma", ["-v"]);
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  assert.equal(res.error, undefined, String(res.error));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /prisma/i);
});

test("LB3：入口缺失时给出可操作的报错，而不是静默失败", () => {
  assert.throws(() => localBin("prisma", [], path.join(process.cwd(), "__no_such_dir__")), /npm install/);
});

test("LB4：测试基建脚本不得再直接 spawn node_modules/.bin 下的 CLI", () => {
  const files = ["scripts/prepare-test-database.ts", "scripts/verify-migration-replay.ts", "tests/datetime-format.test.ts"];
  for (const f of files) {
    // 只看代码：使用说明注释里出现命令行写法不算违规。
    const text = fs
      .readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    assert.ok(!/node_modules[\\/]\.bin[\\/]/.test(text), `${f} 仍直接调用 node_modules/.bin`);
  }
});

test("LB5：npm 脚本不得用 POSIX 环境变量前缀（Windows 的 cmd.exe 不认 `VAR=x cmd`）", () => {
  const scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts as Record<string, string>;
  const offenders = Object.entries(scripts)
    .filter(([, cmd]) => /^\s*[A-Z_][A-Z0-9_]*=/.test(cmd))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], `请改为 bash -c "VAR=x ..." 或在脚本内设默认值：${offenders.join(", ")}`);
});
