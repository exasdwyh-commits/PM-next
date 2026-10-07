/**
 * 样式表语法守卫（2026-10-04）
 * ================================
 * 为什么需要它
 * ------------
 * 本项目**所有**既有样式守卫（tests/ui-quiet-enterprise.ts 的源码守卫 3/4/5/6c）
 * 都是**正则**扫源码的：它们能回答「某个类名有没有定义」「有没有内联 hex」
 * 「令牌有没有自引用成环」，但**没有一个能回答「这份 CSS 语法合法吗」**。
 *
 * 代价是实打实的：本轮改动中，workbench.css 一度出现花括号不配平，
 * tsc --noEmit 通过、eslint 通过、79 项 source-guards 通过、正则式 ui-quiet-enterprise
 * 也通过 —— 四道门全部放行，只有 dev server 启动时才报出来。
 * 换句话说，**CSS 的语法层此前没有任何回归保护**，任何人都能悄悄提交一份坏掉的样式表。
 *
 * 做法
 * ----
 * 用 postcss（已在 devDependencies，8.5.x，不新增依赖）**真正解析** src 下全部 css。
 * postcss 只要求语法合法，不做浏览器兼容性判断，也不会执行任何内容——
 * 它是纯解析器，不引入代码执行风险。
 *
 * 覆盖面
 * ------
 * 扫 src 下全部 css，包含 globals.css、theme/、muse/、workbench.css、components/ 等
 * 现有 10 个样式表，以及将来新增的任何一个（自动发现，不维护清单）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const SRC = path.resolve(process.cwd(), "src");
const SKIP = new Set(["node_modules", ".next", ".next-verify", ".next-acc", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const cssFiles = walk(SRC)
  .filter((f) => f.endsWith(".css"))
  .sort();

test("CS1：src 下存在样式表（避免守卫因路径变更而空转）", () => {
  assert.ok(
    cssFiles.length > 0,
    `未在 ${SRC} 下找到任何 css 文件 —— 守卫本身失效了（检查 SRC 路径与 SKIP 列表）`,
  );
});

test("CS2：全部样式表语法可被 postcss 解析（括号配平 / 无效声明不报错）", () => {
  const failures: string[] = [];
  for (const file of cssFiles) {
    const text = fs.readFileSync(file, "utf8");
    try {
      postcss.parse(text, { from: file });
    } catch (error) {
      const e = error as { reason?: string; line?: number; column?: number };
      const rel = path.relative(process.cwd(), file);
      const where = e.line ? ` (${rel}:${e.line}:${e.column ?? 0})` : ` (${rel})`;
      failures.push(`${where} ${e.reason ?? String(error)}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `样式表存在语法错误，浏览器会丢弃整段规则：\n  ${failures.join("\n  ")}`,
  );
});

test("CS3：样式表非空且块注释配平（截断的常见形态）", () => {
  const bad: string[] = [];
  for (const file of cssFiles) {
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);
    if (text.trim().length === 0) bad.push(`${rel}：文件为空`);
    const opens = (text.match(/\/\*/g) || []).length;
    const closes = (text.match(/\*\//g) || []).length;
    if (opens !== closes) {
      bad.push(`${rel}：块注释不配平（${opens} 个起始符对 ${closes} 个闭合符）`);
    }
  }
  assert.deepEqual(bad, [], `样式表存在截断或空文件：\n  ${bad.join("\n  ")}`);
});