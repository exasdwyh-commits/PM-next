import fs from "node:fs";
import path from "node:path";

/**
 * 跨平台调用本仓库安装的 CLI。
 *
 * `node_modules/.bin/<name>` 在 Windows 上是 shell 脚本（另有 .cmd），`spawnSync` / `execFileSync`
 * 不经 shell 直接执行会得到 ENOENT —— 进程根本没启动，status 为 null、输出为空。
 * 统一改为「用当前 node 执行包的 JS 入口」，在 macOS / Linux / Windows 上行为一致。
 */
const ENTRIES = {
  prisma: "node_modules/prisma/build/index.js",
  tsx: "node_modules/tsx/dist/cli.mjs",
} as const;

export type LocalBin = keyof typeof ENTRIES;

/** 返回 `[可执行文件, 参数]`，直接展开给 spawnSync / execFileSync。 */
export function localBin(name: LocalBin, args: readonly string[], cwd: string = process.cwd()): [string, string[]] {
  const entry = path.resolve(cwd, ENTRIES[name]);
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到本地 ${name} 入口：${entry}（请先 npm install）`);
  }
  return [process.execPath, [entry, ...args]];
}
