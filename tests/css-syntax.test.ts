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

/* ==========================================================================
   CS4 · 字面色值冻结（回归棘轮，2026-10-14 增）
   ==========================================================================

   为什么加这条
   ------------
   2026-10-14 用户截图：角色视图「卖点」卡在暗色下浅底浅字，实测 1.00:1，整块读不出来。
   根因是**配色只写了一半**：底色写死 `#fdf3e2`（永远浅），文字走主题令牌（暗色翻浅）。

   既有守卫为什么抓不到（实测，不是推断）
   ------------------------------------
   · `tests/ui-quiet-enterprise.ts` 的「内联色值 = 0」只扫 `.ts/.tsx`
     （`walk(SRC).filter(f => /\.(ts|tsx)$/)`），**任何 .css 里的字面色值都没有守卫看着**。
   · `tests/css-theme-pairing.test.ts` 只抓「**同一规则内**背景与文字不同源」。
     而这个 bug 是**跨规则**的：父元素 `.rb-sales-prose` 负责底、子元素负责字 ——
     把 `var(--warn-bg)` 回退成 `#fdf3e2` 后，该守卫仍 EXIT=0（已实测）。

   做法：棘轮（只收紧，不放松）
   --------------------------
   文件一旦被**人工确认**清零了颜色属性的字面色值，就登记进 `FROZEN`；
   此后该文件再出现任何字面色值即判失败。**零维护**：不需要快照文件，
   也不做「数量对比」，判据就是「必须为 0」。
   反向不设卡：从 FROZEN 里删条目永远是允许的（那是进一步收紧或文件退役）。

   豁免
   ----
   品牌/状态图形色（进度条、渐变端点、圆点、虚线边）在明暗两态下都可见，
   且改令牌会变更既定视觉，故逐值豁免。**豁免必须逐条写明理由**——
   这张表一旦变成收容所，守卫就失去意义。
   ========================================================================== */

const COLOR_PROPS_RE =
  /^(?:color|background|background-color|border|border-color|border-(?:top|right|bottom|left)(?:-color)?|outline|outline-color|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/;
const LITERAL_COLOR_RE =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|gray|grey|silver|whitesmoke|ivory|beige|snow|red|blue|green|orange|yellow|purple|pink|brown|cyan|magenta|lime|navy|teal|olive|maroon|aqua|fuchsia)\b/gi;

const FROZEN = new Map<string, { since: string; why: string; exempt: Map<string, string> }>([
  [
    "src/app/muse/response/response-role.css",
    {
      since: "2026-10-14",
      why: "用户截图的浅底浅字根因文件：底色写死而文字走主题令牌，暗色下 1.00:1。已全量令牌化，冻结防回退。",
      exempt: new Map([
        ["#2563eb", "品牌蓝：迷你条 / 进度条填充，暗色下对 --surface 仍可见，且改令牌会变更既定视觉"],
        ["#7c6cf5", "品牌蓝的渐变端点（与 #2563eb 成对出现在同一条进度条渐变里）"],
        ["#ccc", "进度点（8px 圆点），暗色下对深底高对比可见"],
        ["#9ca3af", "「待确认」虚线圆边，暗色下可见"],
      ]),
    },
  ],
]);

test("CS4：已冻结的样式表不得再出现字面色值（防配色回退）", () => {
  const violations: string[] = [];

  for (const [rel, cfg] of FROZEN) {
    const file = path.join(process.cwd(), rel);
    assert.ok(fs.existsSync(file), `冻结清单里的文件不存在：${rel}（改过名请同步更新 FROZEN）`);

    const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
    root.walkDecls((decl) => {
      if (!COLOR_PROPS_RE.test(decl.prop.toLowerCase())) return;
      const value = decl.value;
      // 含 var() 即以令牌为准（fallback 只是兜底，不构成固定色）——与 css-theme-pairing 同一约定
      if (/\bvar\(/.test(value)) return;
      const literals = value.match(LITERAL_COLOR_RE) || [];
      const offending = literals.map((l) => l.toLowerCase()).filter((l) => !cfg.exempt.has(l));
      if (offending.length) {
        violations.push(`${rel}:${decl.source?.start?.line ?? "?"}  ${decl.prop}: ${value.trim()}`);
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    [
      "已冻结的样式表里出现了字面色值——暗色模式下很可能又变成「浅底浅字 / 固定字」：",
      ...violations.map((v) => `  ${v}`),
      "",
      "修法：改用语义令牌（--line/--warn-bg/--info-bg/--ink-2 …），两边都随主题翻转；",
      "确属有意写法（品牌图形色等）请在 FROZEN 的 exempt 里逐条登记并写明理由。",
    ].join("\n"),
  );

  // 冻结清单的每条豁免都必须写明理由，否则豁免表会退化成收容所
  const undocumented = [...FROZEN].flatMap(([rel, cfg]) =>
    [...cfg.exempt]
      .filter(([, why]) => !why || why.trim().length < 8)
      .map(([value]) => `${rel} :: ${value}`),
  );
  assert.deepEqual(undocumented, [], "豁免项必须逐条写明理由");
});
