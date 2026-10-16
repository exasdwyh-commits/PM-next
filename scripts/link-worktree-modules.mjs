#!/usr/bin/env node
/**
 * 为多工作树准备隔离的 node_modules（P0 副作用根治方案）
 *
 * 问题：`.tmp-kern/*` 下的工作树用「整目录 junction」共享 PM-next 的 node_modules。
 * Prisma 生成的客户端落在 `node_modules/.prisma/client`，于是**任何一个工作树跑
 * `prisma generate`，都会改写所有工作树共用的那份客户端**。当两个工作树的
 * `prisma/schema.prisma` 不一致时，就会出现「在 A 工作树生成，B 工作树类型报错」。
 *
 * 方案：把 node_modules 拆成
 *   - 逐项 junction（除 `.prisma` 外全部指向源工作树，零额外磁盘）
 *   - `.prisma` 实体目录（各工作树独立生成，互不影响）
 *
 * 安全约定（重要）：
 *   本脚本**只创建、从不删除**。目标目录若已存在会直接报错退出，
 *   并打印「只删链接、不删内容」的安全命令，由人确认后执行。
 *   这样即使脚本有 bug，也不可能顺着 junction 删掉源工作树的依赖。
 *
 * 用法：
 *   node scripts/link-worktree-modules.mjs <目标工作树路径> [--source <源工作树路径>]
 *   node scripts/link-worktree-modules.mjs <目标工作树路径> --apply   # 默认只演练
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sourceFlag = args.indexOf("--source");
const positional = args.filter(
  (arg, index) =>
    !arg.startsWith("--") && (sourceFlag === -1 || index !== sourceFlag + 1)
);

const target = positional[0];
if (!target) {
  console.error(
    "用法：node scripts/link-worktree-modules.mjs <目标工作树路径> [--source <源工作树路径>] [--apply]"
  );
  process.exit(2);
}

const targetRoot = path.resolve(target);
const sourceRoot = path.resolve(
  sourceFlag !== -1 ? args[sourceFlag + 1] : path.join(targetRoot, "..", "..", "PM-next")
);

const sourceModules = path.join(sourceRoot, "node_modules");
const targetModules = path.join(targetRoot, "node_modules");

if (!fs.existsSync(sourceModules)) {
  console.error(`源依赖目录不存在：${sourceModules}`);
  process.exit(2);
}
if (!fs.existsSync(targetRoot)) {
  console.error(`目标工作树不存在：${targetRoot}`);
  process.exit(2);
}

if (fs.existsSync(targetModules)) {
  console.error(
    [
      `目标已存在 node_modules：${targetModules}`,
      "本脚本不会删除任何东西。若要重做，请先由人确认后执行下面这条命令",
      "（它只删 junction 链接，不会删源工作树里的内容）：",
      "",
      `  cmd /c rmdir "${targetModules}"`,
      "",
      "确认目录已被移除后，再重新运行本脚本。",
    ].join("\n")
  );
  process.exit(3);
}

/** 需要保持实体（不共享）的顶层条目。 */
const KEEP_LOCAL = new Set([".prisma"]);

const entries = fs.readdirSync(sourceModules, { withFileTypes: true });
const toLink = entries.filter(
  (entry) => !KEEP_LOCAL.has(entry.name) && !entry.name.startsWith(".")
);
const toCopy = entries.filter((entry) => KEEP_LOCAL.has(entry.name));

console.log(`源：${sourceModules}`);
console.log(`目标：${targetModules}`);
console.log(`模式：${apply ? "执行" : "演练（默认，加 --apply 才真正创建）"}`);
console.log(`  共享（junction）：${toLink.length} 项`);
console.log(`  本地实体（复制）：${toCopy.map((e) => e.name).join("、") || "（无）"}`);

if (!apply) {
  console.log("\n演练结束，未改动磁盘。");
  process.exit(0);
}

fs.mkdirSync(targetModules, { recursive: true });

let linked = 0;
for (const entry of toLink) {
  const from = path.join(sourceModules, entry.name);
  const to = path.join(targetModules, entry.name);
  // Windows 用 junction（不需要管理员权限），其他平台用符号链接。
  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "mklink", "/J", to, from], { stdio: "ignore" });
  } else {
    fs.symlinkSync(from, to, "dir");
  }
  linked += 1;
}

let copied = 0;
for (const entry of toCopy) {
  const from = path.join(sourceModules, entry.name);
  const to = path.join(targetModules, entry.name);
  fs.cpSync(from, to, { recursive: true });
  copied += 1;
}

console.log(`\n完成：共享 ${linked} 项，实体复制 ${copied} 项。`);
console.log(
  "下一步：在该工作树跑 `npx prisma generate`，客户端只会写进它自己的 node_modules/.prisma。"
);
