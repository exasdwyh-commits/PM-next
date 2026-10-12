/**
 * any 预算守卫（P2 治理）：
 *
 * `src/` 下作为**类型**使用的 `any` 总数不得超过基线，只允许持平或下降。
 * 目的是拦住「新增代码随手写 any」的增量，而不是要求一次性清空存量
 * ——在一个已有数万行的代码库上做全量类型重构，回归风险远大于收益。
 *
 * 计数口径（必须与本文件实现一致；改动口径等于改动基线）：
 * - 扫描 src 目录下所有 .ts / .tsx，排除 .d.ts；
 * - 匹配「独立出现」的 any：前一个字符不能是标识符字符或点号，后一个字符不能是标识符字符。
 *   这样可以排除 company、anyone 这类单词，也排除 foo.any 这种属性访问。
 * - 不区分是否位于注释或字符串中：口径保持简单、可复现，宁可多算不可漏算。
 *
 * 修改基线：**只能调低**。清掉多少就降多少，并在 PR 描述里写明。
 * 确需提高基线时（例如引入必须用 any 的第三方适配层），必须在 PR 里给出理由与替换计划，
 * 不允许静默上调。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** 当前基线。只允许下调。
 *  2026-10-12: 607（初次建立）
 *  2026-10-12: 567（删除 5 个零引用演示组件后随之下调，锁住已清掉的 40 处） */
const BASELINE = 567;

/** 独立的 any：前后都不是标识符字符，且不是属性访问。 */
const ANY_RE = /(?<![\w.])any(?![\w])/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

test(`src/ 中作为类型使用的 any 不超过基线 ${BASELINE}`, () => {
  const per = new Map<string, number>();
  let total = 0;
  for (const f of walk(path.join(process.cwd(), "src"))) {
    const rel = path.relative(process.cwd(), f).split(path.sep).join("/");
    const n = (fs.readFileSync(f, "utf8").match(ANY_RE) ?? []).length;
    if (n > 0) {
      per.set(rel, n);
      total += n;
    }
  }
  const top = [...per.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([f, n]) => `  ${String(n).padStart(4)}  ${f}`)
    .join("\n");

  assert.ok(
    total <= BASELINE,
    `src/ 中 any 出现 ${total} 次，超出基线 ${BASELINE}（增量 ${total - BASELINE}）。\n` +
      `请改用具体类型、unknown + 收窄，或泛型；不要上调基线。\n` +
      `当前最多的文件：\n${top}`,
  );
});
