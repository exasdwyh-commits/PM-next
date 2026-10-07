#!/usr/bin/env node
/** 跨平台 bash 启动器：Windows 下优先用 Git Bash（PATH 里的裸 bash 可能是无 node 的 WSL bash），其余平台沿用 PATH 中的 bash。 */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");

function findBash() {
  if (process.platform === "win32") {
    for (const p of [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ]) {
      try {
        if (existsSync(p)) return p;
      } catch {
        /* 忽略不可访问的候选路径，继续下一个 */
      }
    }
  }
  return "bash";
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/run-sh.js <script> [args...]");
  process.exit(2);
}
const bash = findBash();
const r = spawnSync(bash, args, { stdio: "inherit" });
if (r.error) {
  console.error(`[run-sh] 无法启动 ${bash}: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
