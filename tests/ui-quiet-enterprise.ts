/**
 * Quiet Enterprise 迁移回归锁（2026-09-17）
 *
 * 盯住本次视觉系统迁移（paper/teal → Quiet Enterprise）里**最容易悄悄回退**的几件事：
 *   A. 源码级守卫（无需服务，极便宜）：令牌收敛、语义类名冻结、loading.tsx=0、
 *      `.project-row` 首列、thinking 降动画兜底、viz 不制造 Suspense 边界；
 *   B. 渲染级守卫（renderToStaticMarkup，确定性）：四组机制的三态退化 —— 无来源不画点、
 *      未建档不显示分数、枚举不外泄、时间走 datetime.ts；
 *   C. 运行时守卫（Playwright，可选）：390px 无横向溢出、`.project-row` 首列 ≥200px、
 *      reduced-motion 下 viz 静止可读。
 *
 * 运行：
 *   tsx tests/ui-quiet-enterprise.ts                      # 仅 A + B（无需服务）
 *   bash scripts/acc-server.sh tests/ui-quiet-enterprise.ts   # 追加 C（需 3111 服务）
 *
 * 每个守卫都必须能真的变红，见文件末尾「变异验证」。
 */
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepTrack, GateLine, ProgressRing, BubbleChart, Timeline, resolveAxis } from "../src/components/viz";

// viz.tsx 未显式 import React（Next 用自动 JSX 运行时）；tsx(esbuild) 走 classic 运行时，
// 需要把 React 挂到全局，否则会报 "React is not defined"。
(globalThis as any).React = React;

const SRC = path.resolve(process.cwd(), "src");
const SKIP = new Set(["node_modules", ".next", ".next-verify", ".git"]);

let passed = 0;
const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}
function section(title: string) {
  console.log(`\n▶ ${title}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const stripComments = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/gm, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));

const css = stripComments(fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8"));
const themeCss = stripComments(fs.readFileSync(path.join(SRC, "app/theme/quiet-enterprise.css"), "utf8"));
const museCss = stripComments(fs.readFileSync(path.join(SRC, "app/muse/muse.css"), "utf8"));
/**
 * 类名契约的「已定义」集合必须覆盖**全部**项目样式表。
 * 2026-09-27 修：此前只读 globals.css，于是 muse.css 里定义好的类（如 .m-row.is-live）
 * 被误报成「未定义」。这种误报的处理方式往往是把它塞进 UNSTYLED_HOOKS，
 * 而那会把登记表从「有意无样式」退化成「误报收容所」，守卫也就失去意义了。
 *
 * 2026-10-04 再修：上次的修复只把 muse.css 加进来，写成了三个文件的硬编码列表，
 * 于是「覆盖全部」这个承诺再次落空——workbench.css（.kx-wb-row.is-dot）、
 * kx.css（.kx-*-t.is-enter）等后来新增的样式表都没被读入，
 * .is-dot / .is-enter 因此被误报为「未定义」（本轮实测 9 个误报里占 2 个）。
 * 症状和 2026-09-27 那次完全一样，而修法也退化成往 UNSTYLED_HOOKS 里塞名字。
 *
 * 现在改为**扫描 src 下全部 .css**，新增样式表自动纳入，不再靠人工维护清单。
 * 顺序按路径排序，保证报错信息稳定可比。
 */
const projectCssFiles = walk(SRC)
  .filter((f) => f.endsWith(".css"))
  .sort();
const allCss = projectCssFiles.map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
const projectCssNames = projectCssFiles.map((f) => path.relative(process.cwd(), f));

/**
 * G1 · 令牌自引用成环检测：只命中**同名**的 `--x:var(--x[, fallback])`。
 *   不同名的兼容别名（如 `--muted:var(--ink-muted)`）合法，不算成环。
 *   历史上 `--ink:var(--ink)` / `--line:var(--line)` 会把令牌算成空串，
 *   border-color 回落 currentColor（近黑），靠人肉才发现 —— 此守卫把它钉死。
 *   2026-09-18 收紧：**带 fallback 的自引用** `--x:var(--x, #fff)` 同样成环
 *   （fallback 不解除自引用空值），故匹配 `var(\s*--x\s*[,)]`（`)` 或 `,` 结尾都算）。
 */
function findTokenCycles(text: string): string[] {
  const re = /(--[A-Za-z0-9-]+)\s*:\s*var\(\s*(--[A-Za-z0-9-]+)\s*[,)]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[1] === m[2]) out.push(m[0].replace(/\s+/g, ""));
  return out;
}

/**
 * G2 · 内联色值形态（裸 hex / 函数式颜色）；供源码守卫与变异验证共用同一口径。
 *   2026-09-18 收紧：除 `rgb(`/`rgba(` 外，覆盖 `hsl|hsla|hwb|lab|lch|oklab|oklch|color(`。
 *   具名色（如 `color:"white"`）**不做正则**——会误伤正文普通英文词；已在
 *   docs/plans §10.9「未覆盖残留」明确登记（诚实登记 > 假装覆盖）。
 */
const INLINE_COLOR_RE = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g;

/**
 * 「类名契约」守卫（2026-09-18 方向反转）
 *
 * 旧做法（FROZEN_CLASSES）：手写一份清单，断言"这些类仍在 globals.css"。
 *   两个问题：① 方向反了——它只保证"CSS 里有"，不保证"src 用得到"，抓不到
 *   「引用了已被改名/删除的类」这类真实回归；② 清单里混进了**当时就已死的类**
 *   （例如当时就已死的『指标卡 / 面板头 / 紧凑搜索 / 执行摘要』等类名），
 *   等于把死 CSS 冻结住，清理时必然撞红——旧守卫因此**保护了本该删掉的东西**。
 *
 * 新做法：**由源码扫描推导**，断言方向反转为
 *   「src className 引用的每个『项目命名空间』类，都必须在 globals.css 里有定义」。
 *   Tailwind 工具类（含 `sm:` 变体前缀、数值刻度）不属于项目命名空间，天然排除。
 *
 * UNSTYLED_HOOKS：极少数**有意不加自身视觉样式**的结构钩子 / 状态标记（默认样式即基线），
 *   逐条说明；守卫额外断言「CSS 未定义的项目类 === 本清单」，因此该清单无法被悄悄扩大——
 *   任何新增的拼错/改名类名都会立刻变红。
 */
const UNSTYLED_HOOKS: Record<string, string> = {
  "project-list": "产品列表包裹层：布局交由 .project-table-head / .project-row 网格承担",
  "is-assistant": "顾问对话『非本人』消息的状态标记：默认样式即基线，仅 is-user 需要覆盖，故无自身规则",
  "hermes-desktop-panel": "本机执行面板根容器：自身不描边不着色，视觉由 .hermes-desktop-panel-head 与各子块承担",
  "m-contract-review": "验收清单卡片根节点的语义标记（contract-card.tsx 里硬编码，非动态变体）：该区块的视觉已由 .m-contract-checks / .m-contract-mark / .m-contract-note 承担，与「任务契约」卡片的区别靠内容与 aria-label 表达，不需要额外皮肤；给它凭空补一套配色属于设计决策，不在守卫修复范围内",
};

/** 项目命名空间前缀（设计系统自建类），用于把 Tailwind 工具类排除在契约之外。 */
const PROJECT_PREFIX =
  /^(hermes|project|viz|bubble|panel|decision|hero|detail|metric|owner|row|stage|health|empty|modal|mode|form|compact|user|tiny|star|sparkline|mini|negative|blue|copper|green|muted|date|profile|eyebrow|top|milestone|kx|kr|m|is)-/;
const PROJECT_BARE = new Set(["eyebrow", "star", "milestone", "negative", "sparkline", "blue", "copper", "green"]);
/**
 * Tailwind 的外边距工具类与 muse 的 `m-*` 类名前缀撞车（`m-0`/`m-4` vs `m-home`）。
 * Tailwind 的间距值域是封闭的：数字、auto、px，以及负号前缀。
 * 命中这些值的一律按 Tailwind 工具类排除；其余 `m-*` 仍按项目类名送进契约。
 */
const TAILWIND_SPACING_VALUE = /^-?(?:\d+(?:\.\d+)?|auto|px)$/;
const isTailwindMargin = (t: string) => /^m[xytblr]?-(?:\d+(?:\.\d+)?|auto|px)$/.test(t);
const isProjectToken = (t: string) =>
  PROJECT_BARE.has(t) ||
  (PROJECT_PREFIX.test(t + "-") && !(t.startsWith("m") && TAILWIND_SPACING_VALUE.test(t.slice(2))));

/** 抽取 src 中 className 字面量的 token（去注释；忽略模板串里的 `${}` 片段）。 */
function srcClassNameTokens(): Set<string> {
  const out = new Set<string>();
  for (const f of walk(SRC)) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const text = stripComments(fs.readFileSync(f, "utf8"));
    const re = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const direct = m[1] ?? m[2];
      if (direct !== undefined) {
        direct.split(/\s+/).forEach((t) => t && out.add(t));
        continue;
      }
      let i = re.lastIndex;
      let depth = 1;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        i += 1;
      }
      const expr = text.slice(re.lastIndex, i - 1);
      const litRe = /["'`]([^"'`]*)["'`]/g;
      let lm: RegExpExecArray | null;
      while ((lm = litRe.exec(expr))) lm[1].split(/\s+/).forEach((t) => t && out.add(t));
    }
  }
  return out;
}

// ===========================================================================
// B. 渲染级守卫（renderToStaticMarkup，确定性）
// ===========================================================================
function renderGates() {
  return renderToStaticMarkup(
    React.createElement(GateLine, {
      gates: [
        { key: "G1", label: "研发打样门", state: "not-created", source: "decision-packet" },
        { key: "G2", label: "生产门", state: "not-created", source: "decision-packet" },
        { key: "G3", label: "上市放行", state: "not-created", source: "launch-plan" },
      ],
    }),
  );
}

function runRenderGuards() {
  section("源码守卫 1：路线级 loading.tsx = 0（防 P0 复发）");
  const appLoading = walk(path.join(SRC, "app"))
    .filter((f) => path.basename(f) === "loading.tsx")
    .map((f) => path.relative(process.cwd(), f));
  ok(appLoading.length === 0, `src/app 下 loading.tsx 数量为 0（实际 ${appLoading.length}：${appLoading.join(", ") || "无"}）`);

  section("源码守卫 2：viz.tsx 不制造客户端 / 流式边界");
  const vizSrc = stripComments(fs.readFileSync(path.join(SRC, "components/viz.tsx"), "utf8"));
  ok(!/"use client"/.test(vizSrc), "viz.tsx 无 \"use client\"（服务端可 SSR）");
  ok(!/Suspense/.test(vizSrc), "viz.tsx 不使用 Suspense（避免把后代 notFound() 的 404 变 200）");
  ok(!/\buse(State|Effect|Memo|Reducer|Ref|SyncExternalStore)\b/.test(vizSrc), "viz.tsx 无任何 React hook（纯展示）");

  section("源码守卫 3：类名契约（src className 引用的项目类必须在项目样式表里有定义）");
  const cssClean = allCss
    .replace(/@import[^;]*;/g, " ")
    .replace(/url\([^)]*\)/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ");
  const cssClassSet = new Set((cssClean.match(/\.([a-zA-Z_][\w-]*)/g) || []).map((s) => s.slice(1)));
  const refTokens = [...srcClassNameTokens()].filter((t) => !t.includes("${") && isProjectToken(t)).sort();
  const undefinedTokens = refTokens.filter((c) => !cssClassSet.has(c));
  ok(undefinedTokens.every((c) => c in UNSTYLED_HOOKS),
    `src 引用的 ${refTokens.length} 个项目类名里，全部项目样式表都未定义的只应是已登记的「无样式钩子」（实际 ${undefinedTokens.length}：${undefinedTokens.join(", ") || "无"}）`);
  const hooks = Object.keys(UNSTYLED_HOOKS).sort();
  const sameSet = undefinedTokens.slice().sort().length === hooks.length && undefinedTokens.slice().sort().every((c, i) => c === hooks[i]);
  ok(sameSet,
    `CSS 未定义集合 ⟷ 登记的「有意无样式钩子」集合逐一相等（登记 ${hooks.length}：${hooks.join(", ")}）`);

  section("源码守卫 4：颜色收敛（globals.css 去注释后 unique hex/rgba = 0）");
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgb = css.match(/rgba?\([^)]*\)/g) || [];
  const hexUniq = new Set(hex.map((h) => h.toLowerCase()));
  const rgbUniq = new Set(rgb.map((r) => r.replace(/\s+/g, "").toLowerCase()));
  ok(hexUniq.size === 0, `globals.css 内联 hex 唯一值 0（实际 ${hexUniq.size}：${[...hexUniq].join(",")}）`);
  ok(rgbUniq.size === 0, `globals.css 内联 rgba 唯一值 0（实际 ${rgbUniq.size}：${[...rgbUniq].join(",")}）`);

  section("源码守卫 4b：令牌不得自引用成环（--x:var(--x[, fallback]) = 0）[G1]");
  const cycleHits = [...findTokenCycles(css), ...findTokenCycles(themeCss)];
  ok(
    cycleHits.length === 0,
    `globals.css + theme/quiet-enterprise.css 同名自引用令牌（含 fallback）0 处（实际 ${cycleHits.length}：${cycleHits.join(", ") || "无"}）`,
  );

  section("源码守卫 4c：src .ts/.tsx 内联色值 = 0（hex / 函数式颜色）[G2]");
  // 顾问 / 研究模块由另一 agent 并行开发，暂不设卡；对方合入后应把下列排除项**移除**、重新纳入。
  const COLOR_GUARD_EXCLUDE = ["/advisor/", "/consultation/", "/api/conversations/", "/research/"];
  /**
   * 唯一的**永久**例外：导出件调色板。
   * 导出页（MD/PDF）是脱离应用运行的独立文档，用户可能离线打开或直接打印，
   * 拿不到 theme 令牌层，必须自带色值。因此不禁止它有色值，而是要求
   * **全部集中在 PRINT_PALETTE 一个常量里**——常量外仍然一处都不许有。
   */
  const PALETTE_OWNER = "src/modules/supervisor/report-format.ts";
  const PALETTE_RE = /const PRINT_PALETTE = \{[\s\S]*?\} as const;/;
  const isColorExcluded = (f: string) => {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    return COLOR_GUARD_EXCLUDE.some((p) => rel.includes(p));
  };
  const tsFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
  const colorScanned = tsFiles.filter((f) => !isColorExcluded(f));
  const colorExcluded = tsFiles.filter(isColorExcluded).map((f) => path.relative(process.cwd(), f)).sort();
  const colorHits: string[] = [];
  for (const f of colorScanned) {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    let text = stripComments(fs.readFileSync(f, "utf8"));
    if (rel === PALETTE_OWNER) text = text.replace(PALETTE_RE, " ");
    const hits = text.match(INLINE_COLOR_RE) || [];
    if (hits.length) colorHits.push(`${path.relative(process.cwd(), f)} → ${[...new Set(hits)].join(",")}`);
  }
  ok(
    colorHits.length === 0,
    `src .ts/.tsx 内联色值（hex / rgb|hsl|oklch… 函数式）= 0（实际 ${colorHits.length}：${colorHits.slice(0, 6).join(" | ") || "无"}）`,
  );
  // 例外不能变成空头支票：常量本身必须存在，否则上面的豁免就等于放行整个文件。
  ok(
    PALETTE_RE.test(fs.readFileSync(path.join(process.cwd(), PALETTE_OWNER), "utf8")),
    `${PALETTE_OWNER} 的导出色值集中在 PRINT_PALETTE 常量内（该常量是全 src 唯一允许出现字面色值的位置）`,
  );
  console.log(`  ℹ G2 临时排除（并行开发；对方合入后应重新纳入）${colorExcluded.length} 个文件：`);
  for (const f of colorExcluded) console.log(`      - ${f}`);

  section("源码守卫 5：.project-row 列模板不得回退（首列 minmax(200px,…)，7 列）");
  const projRow = css.match(/\.project-table-head,\.project-row \{[^}]*grid-template-columns:[^;]*;/);
  ok(!!projRow, ".hermes 项目中存在 .project-table-head,.project-row 的 grid-template-columns 定义");
  const cols = projRow ? projRow[0].slice(projRow[0].indexOf("grid-template-columns:")) : "";
  ok(/minmax\(200px,/.test(cols), `.project-row 首列轨道 ≥200px（实际「${cols.replace(/grid-template-columns:/, "").slice(0, 60)}…」）`);

  section("源码守卫 6：thinking 标签降动画兜底必须回退为不透明深色");
  const reduceRule = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^@]*?\.hermes-thinking-label \{[\s\S]*?\}/);
  const thinkingReduce = css.match(/\.hermes-thinking-label \{\s*background:none;\s*-webkit-text-fill-color:var\(--accent-hover\);\s*color:var\(--accent-hover\);/);
  ok(!!reduceRule, "reduce 媒体查询内含 .hermes-thinking-label 兜底规则");
  ok(!!thinkingReduce,
    "reduce 下 -webkit-text-fill-color / color 均回退为不透明 --accent-hover（非 transparent）");

  section("源码守卫 6c：响应式阶梯与关键断点规则（§10 rev2 · H3/H5/H6/H7 + A11y）");
  /**
   * 2026-10-04：这一条原先检查「所有 max-width 媒体查询是否按由宽到窄声明」。
   *
   * 那个形式判据与它想保护的东西并不对应。本文件按**功能**组织（不是按断点组织），
   * 同一个断点分散在多处本属正常；而真正会伤到用户的只有一种情况：
   * **等特异度下，靠后的宽断点覆盖了靠前窄断点对同一选择器同一属性的声明**
   * （max-width 是"低于某宽度即命中"，所以 390px 会同时命中 520 与 620）。
   *
   * 实测确认了这一点，也确认了形式判据会大量误报：本轮 globals.css 的 24 个
   * max-width 块里，真正「窄被宽覆盖」的只有 4 对，其中 2 对两边值相同
   * （.hermes-topbar-title strong 的 font-size、.hermes-topbar-title 的 min-width），
   * 实际只有 2 对产生视觉差异（.hermes-content / .hermes-topbar 的 padding），
   * 已在文件末尾用一段窄屏收口块修掉（见该块注释）。
   *
   * 现在改为直接检测级联冲突——**测意图本身**，而不是测一个容易误报的形式，
   * 也不需要把 2500+ 行按功能组织的 CSS 重排成按断点组织（那是高风险且无收益的
   * 大改）。断点数量下限仍保留，确保响应式阶梯没有被整体删掉。
   */
  const mediaWidths = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
  ok(mediaWidths.length >= 7,
    `max-width 媒体查询数量 ≥ 7（实际 ${mediaWidths.length}：${mediaWidths.join(" → ") || "无"}）`);

  // 按括号配平精确切出每个 @media (max-width:Npx) 块，记录「选择器+属性 → 值」。
  type Decl = { prop: string; value: string };
  const bySelector = new Map<string, Decl[]>();
  {
    let i = 0;
    while (i < css.length) {
      const m = /@media\s*\(max-width:\s*(\d+)px\)/.exec(css.slice(i));
      if (!m) break;
      const blockWidth = Number(m[1]);
      const braceStart = css.indexOf("{", i + m.index);
      if (braceStart < 0) break;
      let depth = 0;
      let j = braceStart;
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      const block = css.slice(braceStart + 1, j);
      for (const rule of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim().replace(/\s+/g, " ");
        if (selector.startsWith("@")) continue;
        for (const d of rule[2].matchAll(/([-a-zA-Z]+)\s*:\s*([^;]+)/g)) {
          const key = selector;
          const list = bySelector.get(key) ?? [];
          list.push({ prop: d[1], value: d[2].trim() });
          bySelector.set(key, list);
        }
      }
      i = j + 1;
    }
  }
  // 冲突判定：对每个 (选择器, 属性) 收集**全部**出现（源码序 + 断点宽 + 值），
  // 只要存在一对「窄断点声明在前、宽断点声明在后、且值不同」，就算冲突——
  // 因为 max-width 是「低于该宽度即命中」，窄屏下两者同时生效，后声明者胜，
  // 于是窄断点在这条属性上被静默覆盖。
  //
  // 2026-10-04 修正：初版只记「首次出现」再比宽度，而首次出现几乎总在最宽的断点
  // （如 .hermes-content 的 padding 首现于 1280px），条件 `prev.width < w` 恒为假，
  // 守卫形同虚设——注入一个 900px 覆盖块也不变红。现改为全配对比较。
  /**
   * 「窄断点被靠后宽断点覆盖」的**已论证例外**。
   *
   * 背景：本文件 globals.css 里有两处 520 断点声明，被更靠后的 620 断点覆盖：
   *   .hermes-content { padding }  ≤520 写 12px 10px 40px → 620 写 12px 14px 40px
   *   .hermes-topbar  { padding }  ≤520 写 8px 10px 8px 12px → 620 写 6px 14px
   *
   * 为什么不修成「520 的值赢」：
   * 620 那块是后加的**移动端外壳**整体设计（侧栏隐藏 + 移动菜单 + 弹窗安全区），
   * 它的 `.hermes-topbar { margin: -12px -14px 12px; padding: 6px 14px }` 是
   * **成对**的——负外边距让顶栏左右出血，与 14px 内边距刚好齐平（横向溢出 0）。
   * 若把 520 的 10px 内边距抢回来，负外边距仍是 -14px，两侧立刻差 4px，
   * ui-motion P1 的「产品页/项目页无横向溢出」会实测失败（已实测：4px）。
   * 所以 520 的那两条是外壳重设计之前的**过时残留**，620 才是当前意图。
   *
   * 代价（如实记录）：≤520 的排版意图今后只能改 620 那块。守卫会在此留痕，
   * 避免下一个「修冲突」的人重犯我这次犯的错。
   */
  const SUPERSEDED_BY_DESIGN: Array<{ key: string; narrow: number; wide: number }> = [
    { key: ".hermes-content { padding }", narrow: 520, wide: 620 },
    { key: ".hermes-topbar { padding }", narrow: 520, wide: 620 },
  ];
  /** 在所有能覆盖 narrow 的声明里，取最宽的那个（即实际生效者） */
  const widestClobberer = (
    list: Array<{ order: number; width: number; value: string }>,
    narrow: { order: number; width: number; value: string },
  ): number =>
    Math.max(
      ...list
        .filter((o) => o.width > narrow.width && o.order > narrow.order && o.value !== narrow.value)
        .map((o) => o.width),
    );
  const cascadeClashes: string[] = [];
  {
    const occ = new Map<string, Array<{ order: number; width: number; value: string }>>();
    let order = 0;
    let i = 0;
    while (i < css.length) {
      const m = /@media\s*\(max-width:\s*(\d+)px\)/.exec(css.slice(i));
      if (!m) break;
      const w = Number(m[1]);
      const braceStart = css.indexOf("{", i + m.index);
      if (braceStart < 0) break;
      let depth = 0;
      let j = braceStart;
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      const block = css.slice(braceStart + 1, j);
      for (const rule of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim().replace(/\s+/g, " ");
        if (selector.startsWith("@")) continue;
        for (const d of rule[2].matchAll(/([-a-zA-Z]+)\s*:\s*([^;]+)/g)) {
          const key = `${selector} { ${d[1]} }`;
          const list = occ.get(key) ?? [];
          list.push({ order: order++, width: w, value: d[2].trim() });
          occ.set(key, list);
        }
      }
      i = j + 1;
    }
    for (const [key, list] of occ) {
      for (const narrow of list) {
        // 存在一个「更宽 + 更靠后 + 值不同」的声明，会在窄屏下赢掉 narrow
        const clobbered = list.some(
          (wide) =>
            wide.width > narrow.width &&
            wide.order > narrow.order &&
            wide.value !== narrow.value,
        );
        if (!clobbered) continue;
        // 已论证的例外：620 移动端外壳整体取代了更早的 520 排版。
        // 见下方 SUPERSEDED_BY_DESIGN 的说明。新增例外必须写清为什么它是
        // 「有意取代」而不是「漏改」，否则等于给真实缺陷开后门。
        const excused = SUPERSEDED_BY_DESIGN.some(
          (e) => e.key === key && e.narrow === narrow.width && e.wide === widestClobberer(list, narrow),
        );
        if (excused) continue;
        // 如果**更靠后**还有一个宽度 ≤ narrow.width、且值与 narrow 相同的声明，
        // 说明作者在级联末端把窄屏意图重新声明了一遍——这不算缺陷。
        const restored = list.some(
          (later) =>
            later.order > narrow.order &&
            later.width <= narrow.width &&
            later.value === narrow.value,
        );
        if (restored) continue;
        const winner = list
          .filter((wide) => wide.width > narrow.width && wide.order > narrow.order)
          .pop();
        cascadeClashes.push(
          `${key}：≤${narrow.width}px 声明 ${narrow.value}，被后声明的 ≤${winner?.width}px 覆盖为 ${winner?.value}`,
        );
        break;
      }
    }
  }
  ok(
    cascadeClashes.length === 0,
    `窄断点声明不被靠后的宽断点覆盖（实际冲突 ${cascadeClashes.length}${cascadeClashes.length ? "：" + [...new Set(cascadeClashes)].slice(0, 4).join(" | ") : ""}）`,
  );
  ok(
    /\.hermes-sidebar \{ display:flex; width:var\(--sidebar-rail\); padding:18px 8px; \}/.test(css) &&
      !/\.hermes-sidebar \{ display:none; \}/.test(css),
    "≤860 侧栏保留 82px rail（不再 display:none → 导航可达）",
  );
  ok(
    /\.viz-steps \{ flex-wrap:wrap; gap:6px 12px; \}/.test(css) && /\.viz-step::after \{ display:none; \}/.test(css),
    "≤860 StepTrack 折行且关闭连接线（H5：折行优于横滚）",
  );
  ok(
    /\.bubble-chart \{ height:280px; margin-left:26px; \}/.test(css) && /\.bubble-chart \{ height:240px; \}/.test(css),
    "气泡图高度分档 280（≤860）/240（≤520）（H7）",
  );
  ok(/\.hermes-modal \{ width:min\(560px,92vw\)/.test(css), "模态宽度 min(560px,92vw)（H6）");
  ok(
    /\.hermes-link \{[^}]*min-height:24px/.test(css) &&
      /\.hermes-inline > input\[type="checkbox"\],\.hermes-inline > input\[type="radio"\] \{ width:24px; height:24px;/.test(css),
    "点击区 ≥24px 全档生效（hermes-link 命中区 / 采纳复选框本体 24px）",
  );
  ok(
    /\.project-row > \*:nth-child\(n\+2\)::before \{ content:attr\(data-label\)/.test(css),
    "≤1100 .project-row 以 data-label 提供行内字段标签（表头隐藏不丢字段）",
  );
  const shellSrc = stripComments(fs.readFileSync(path.join(SRC, "components/app-shell.tsx"), "utf8"));
  ok(/aria-label=\{it\.label\}/.test(shellSrc), "nav 项补 aria-label（≤1180 文字隐藏后补回可访问名）");
  ok(!/"use client"/.test(shellSrc), "app-shell.tsx 仍为服务端组件（无 use client）");
  const productsSrc = stripComments(fs.readFileSync(path.join(SRC, "app/products/products-client.tsx"), "utf8"));
  ok(
    ["生命周期", "评分", "负责人", "目标上市", "项目"].every((l) => productsSrc.includes(`data-label="${l}"`)),
    "product-row 第 2–6 单元格备 data-label（口径同表头）",
  );

  section("渲染守卫 7：枚举 / 轴标签无泄漏");
  const gateHtml = renderGates();
  // 只检查**可见文本**（去掉标签）：data-state / data-source 这类属性合法携带内部标识，
  // 但绝不允许出现在给使用者看的文本里。
  const gateText = gateHtml.replace(/<[^>]*>/g, " ");
  for (const raw of ["RESEARCH_SAMPLING_GATE", "PRODUCTION_GATE", "not-created", "decision-packet", "launch-plan"]) {
    ok(!gateText.includes(raw), `GateLine 可见文本不含内部标识「${raw}」`);
  }
  const bubbleHtml = renderToStaticMarkup(
    React.createElement(BubbleChart, { data: [], xLabel: "价值", yLabel: "匹配度", source: "none" }),
  );
  const bubbleText = bubbleHtml.replace(/<[^>]*>/g, " ");
  for (const raw of ["verified-real", "high", "normal", "low", "valueTier", "importance"]) {
    ok(!bubbleText.includes(raw), `BubbleChart 可见文本不含内部标识「${raw}」`);
  }

  section("渲染守卫 8：门槛线无来源 / 未建档时不得显示通过状态或分数");
  ok(gateHtml.includes("未建档"), "GateLine 未建档态渲染「未建档」");
  ok(/data-state="not-created"/.test(gateHtml), "GateLine 未建档态带 data-state=\"not-created\"");
  ok(!gateHtml.includes("%"), "GateLine 未建档态不含任何百分比");
  ok(gateHtml.includes("依据：决策包") && gateHtml.includes("依据：上市计划"),
    "GateLine 如实标注机制来源（依据：决策包 / 依据：上市计划）");

  section("渲染守卫 9：气泡图无来源 / 空数据时不得画点");
  const dotCount = (h: string) => (h.match(/class="bubble-dot"/g) || []).length;
  ok(dotCount(bubbleHtml) === 0, "source=none 且 data=[] → .bubble-dot 计数为 0");
  ok(bubbleHtml.includes("未建档"), "source=none → 渲染「未建档 / 待补证」");
  const demoHtml = renderToStaticMarkup(
    React.createElement(BubbleChart, { data: [{ id: "a", label: "X", x: 10, y: 20 }], xLabel: "x", yLabel: "y", source: "demo" }),
  );
  ok(dotCount(demoHtml) === 0 && demoHtml.includes("演示数据"), "source=demo → 不画点 + 警示条「演示数据」");

  section("渲染守卫 10：viz 确定性渲染（无时间 / 随机混入）");
  const render2 = (el: React.ReactElement) => renderToStaticMarkup(el);
  ok(render2(React.createElement(StepTrack, { steps: [{ key: "a", label: "研究验证", state: "current" }] })) ===
     render2(React.createElement(StepTrack, { steps: [{ key: "a", label: "研究验证", state: "current" }] })),
    "StepTrack 两次渲染逐字节一致");
  ok(gateHtml === renderGates(), "GateLine 两次渲染逐字节一致");
  ok(render2(React.createElement(ProgressRing, { value: 42 })) === render2(React.createElement(ProgressRing, { value: 42 })),
    "ProgressRing 两次渲染逐字节一致");

  section("渲染守卫 11：ProgressRing value=null → 未建档空环，不显示百分比");
  const ringNull = renderToStaticMarkup(React.createElement(ProgressRing, { value: null, label: "上市准备度" }));
  ok(ringNull.includes("未建档"), "value=null → 渲染「未建档」");
  ok(!ringNull.includes("%"), "value=null → 不显示任何百分比");
  ok(/data-empty="true"/.test(ringNull), "value=null → data-empty=true");
  const ring42 = renderToStaticMarkup(React.createElement(ProgressRing, { value: 42 }));
  ok(ring42.includes("42%") && !ring42.includes("58%"), "有数据时显示真实值，绝不照抄参考包的 58%");

  section("渲染守卫 11b：证据核实环（product-overview 挂载点）—— 口径可追溯、无歧义");
  // total=0 → 未建档空环，点名缺口，且不出现任何百分比
  const ringEvidenceEmpty = renderToStaticMarkup(
    React.createElement(ProgressRing, {
      value: null,
      label: "证据核实",
      caption: "暂无依据可核实（依据总数 0 条）。待补证后再评估已核实占比。",
      tone: "neutral",
    }),
  );
  ok(ringEvidenceEmpty.includes("未建档"), "total=0 → 渲染「未建档」");
  ok(!ringEvidenceEmpty.includes("%"), "total=0 → 不含任何百分比");
  ok(/data-empty="true"/.test(ringEvidenceEmpty), "total=0 → data-empty=true（走空态分支，而非 0%）");
  // total>0 且 verifiedReal=0 → 环在 0，主文本为比率，不得出现「0%」
  const ringEvidenceZero = renderToStaticMarkup(
    React.createElement(ProgressRing, {
      value: 0,
      valueText: "0/12 已核实",
      label: "证据核实",
      caption: "已核实真实依据 0 条 / 依据总数 12 条；未核实与演示数据不计入分子。",
      tone: "neutral",
    }),
  );
  ok(ringEvidenceZero.includes("0/12 已核实"), "verifiedReal=0 且有证据 → 主文本为比率「0/12 已核实」");
  ok(!ringEvidenceZero.includes("%"), "verifiedReal=0 → 不出现「0%」");
  ok(/data-display="ratio"/.test(ringEvidenceZero), "比率文本 → data-display=ratio（环心缩放兜底）");
  ok(ringEvidenceZero.includes("依据总数 12 条") && ringEvidenceZero.includes("不计入分子"),
    "caption 可追溯到口径（依据总数 M 条 + 未核实/演示不计入分子）");
  // 有据 → 显示比率（非百分比）
  const ringEvidenceSome = renderToStaticMarkup(
    React.createElement(ProgressRing, {
      value: 25,
      valueText: "3/12 已核实",
      label: "证据核实",
      caption: "已核实真实依据 3 条 / 依据总数 12 条；未核实与演示数据不计入分子。",
      tone: "ok",
    }),
  );
  ok(ringEvidenceSome.includes("3/12 已核实"), "有据 → 主文本为比率「3/12 已核实」");
  ok(!ringEvidenceSome.includes("%"), "有据 → 环心不出现裸百分比");

  section("源码守卫 6b：product-overview 验证页签确实挂载证据核实环（防接线回退）");
  const povSrc = stripComments(
    fs.readFileSync(path.join(SRC, "app/products/[id]/product-overview-client.tsx"), "utf8"),
  );
  ok(/from "@\/components\/viz"/.test(povSrc) && /\bProgressRing\b/.test(povSrc),
    "product-overview-client 引入并渲染 ProgressRing");
  ok(/overview\.evidenceCompleteness\.total/.test(povSrc) && /overview\.evidenceCompleteness\.verifiedReal/.test(povSrc),
    "环值取自服务端真实口径 evidenceCompleteness（不另算）");
  ok(/evidenceTotal\s*>\s*0\s*\?/.test(povSrc), "只有 total>0 才画环（否则走未建档分支）");
  ok(/valueText=/.test(povSrc) && /已核实/.test(povSrc), "以比率文本作为环心主文本（valueText），不输出裸百分比");
  ok(/依据总数/.test(povSrc) && /不计入分子/.test(povSrc), "文案可追溯到口径（依据总数 + 不计入分子）");

  section("渲染守卫 12：Timeline 空态为真空缺口（Empty 语义），时间走 datetime.ts");
  const tlEmpty = renderToStaticMarkup(React.createElement(Timeline, { items: [] }));
  ok(tlEmpty.includes("hermes-empty") && tlEmpty.includes("暂无记录。"), "空数据 → hermes-empty + 默认空文案");
  const tl = renderToStaticMarkup(
    React.createElement(Timeline, { items: [{ id: "1", at: new Date("2026-09-16T00:45:18Z"), title: "决策包获准" }] }),
  );
  ok(tl.includes("2026-09-16 08:45"), "时间经 datetime.ts 固定 Asia/Shanghai 输出（2026-09-16 08:45）");

  section("渲染守卫 13：resolveAxis 三态（无来源 / 未核实 / 演示都不 ok）");
  ok(resolveAxis({ value: null }).ok === false, "无值 → ok=false");
  ok(resolveAxis({ value: 80, hasReason: false }).ok === false, "有值但无依据 → ok=false（unverified）");
  ok(resolveAxis({ value: 80, hasReason: true, nature: "DEMO" }).ok === false, "演示数据 → ok=false（demo）");
  ok(resolveAxis({ value: 80, hasReason: true, calibrated: false }).ok === false, "未校准 → ok=false");
  ok(resolveAxis({ value: 80, hasReason: true }).ok === true, "有值 + 有依据 + 已核实 → ok=true");
}

// ===========================================================================
// C. 运行时守卫（Playwright，可选）
// ===========================================================================
async function runRuntimeGuards() {
  const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3111";
  let up = false;
  try {
    const res = await fetch(`${BASE}/api/health`);
    up = res.ok;
  } catch {
    up = false;
  }
  if (!up) {
    console.log(`\n▶ 运行时守卫：跳过（${BASE}/api/health 不可达）—— 运行时断言在 acc-server 下执行`);
    return;
  }

  const os = await import("os");
  const crypto = await import("crypto");
  const fsMod = await import("fs");
  const { chromium } = await import("playwright");
  const prisma = (await import("../src/shared/db")).default;
  const { assertTestDatabaseSafety } = await import("./test-safety");
  const { hashPassword } = await import("../src/modules/identity/session");
  await assertTestDatabaseSafety(prisma);

  const HOME = os.homedir();
  // playwright 自己解析的版本优先于硬编码 revision：后者会随 playwright 升级而过期。
  const chromeCandidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  ].filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  const chrome = chromeCandidates.find((p) => fsMod.existsSync(p));
  if (!chrome) {
    console.log("  运行时守卫：未找到 chromium，跳过");
    return;
  }

  const RUN_TAG = `uiqe${Date.now()}`;
  const PASSWORD = `UiQe-${crypto.randomBytes(6).toString("hex")}!`;
  const org = await prisma.organization.create({ data: { code: `${RUN_TAG}_ORG`, name: "Quiet Enterprise 回归机构（合成夹具）" } });
  const owner = await prisma.user.create({
    data: {
      email: `${RUN_TAG}@hermes.test`, name: "回归负责人", organizationId: org.id,
      passwordHash: hashPassword(PASSWORD), orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } },
    },
  });
  const product = await prisma.product.create({
    data: { organizationId: org.id, name: "Quiet Enterprise 回归产品", identityCode: `${RUN_TAG}-P`, targetAudience: "合成", marketPath: "私域", devMode: "NEW_PRODUCT" },
  });
  const project = await prisma.project.create({
    data: { organizationId: org.id, title: `${RUN_TAG}_回归项目`, target: "验证视觉迁移", mode: "NEW_PRODUCT", stage: "RESEARCH", ownerId: owner.id, decisionMakerId: owner.id, productId: product.id, revision: 1 },
  });
  await prisma.projectMember.createMany({ data: [{ projectId: project.id, userId: owner.id, role: "OWNER" }, { projectId: project.id, userId: owner.id, role: "DECISION_MAKER" }] }).catch(() => {});

  const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    section("运行时 14：登录");
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', owner.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u: URL) => !u.toString().includes("/login"), { timeout: 20000 });
    await page.waitForTimeout(600);
    ok(!page.url().includes("/login"), `登录成功（${page.url()}）`);

    section("运行时 15：.project-row 首列 ≥200px（≥1180）");
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const firstCol = await page.evaluate(() => {
      const row = document.querySelector(".project-row") as HTMLElement | null;
      if (!row) return null;
      const tpl = getComputedStyle(row).gridTemplateColumns;
      const first = tpl.split(" ")[0];
      return { tpl, px: parseFloat(first) };
    });
    if (firstCol) {
      ok(firstCol.px >= 200, `.project-row 首列轨道 ≥200px（实际 ${firstCol.px}px，tpl=${firstCol.tpl}）`);
    } else {
      console.log("  ℹ /products 无 .project-row（可能为空态），跳过首列断言");
    }

    section("运行时 16：390px 无横向溢出");
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ["/login", "/", "/products", "/opportunities", "/trace"]) {
      await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= 390, `${p} 在 390px 下 scrollWidth=${sw} ≤ 390`);
    }

    section("运行时 17：reduced-motion 下 viz 静止可读（无动画 + 不透明文字）");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(200);
    const anim = await page.evaluate(() => {
      const sel = [".viz-step i", ".viz-step::after", ".viz-gate .circle", ".progress-ring", ".bubble-dot", ".viz-timeline > li::before"];
      const out: Record<string, string> = {};
      // 只取真实存在的元素（伪元素取不到 animation-name，用 CSS 文本兜底断言）
      for (const s of [".viz-step i", ".viz-gate .circle", ".progress-ring", ".bubble-dot"]) {
        const el = document.querySelector(s) as HTMLElement | null;
        out[s] = el ? getComputedStyle(el).animationName : "(absent)";
      }
      return out;
    });
    for (const [s, name] of Object.entries(anim)) {
      if (name === "(absent)") continue;
      ok(name === "none", `reduce 下 ${s} 的 animation-name 为 none（实际 ${name}）`);
    }
    // 静态兜底：globals.css 明确给 viz 加了 reduce 下的 transition/animation:none
    ok(/\.viz-step i,\.viz-step::after,\.progress-ring,\.bubble-dot \{ transition:none !important; animation:none !important; \}/.test(
      fsMod.readFileSync(path.join(SRC, "app/globals.css"), "utf8"),
    ), "globals.css 含 viz 的 reduce 静态兜底规则");

    // —— §10.5 响应式验收钩子（H1–H8 运行时段；H9 由「运行时 15/16」覆盖；H10 由「源码守卫 3」覆盖） ——
    const WIDTHS = [1440, 1366, 1280, 1180, 1093, 1024, 860, 520, 390];
    const ROUTES = ["/", "/products", "/opportunities", "/trace", "/dashboard"];

    section("运行时 H1：全档 × 多路由 无横向溢出");
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const r of ROUTES) {
        await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(300);
        const dims = await page.evaluate(() => {
          const de = document.documentElement;
          let off: string[] = [];
          if (de.scrollWidth > de.clientWidth + 1) {
            off = (Array.from(document.querySelectorAll("body *")) as HTMLElement[])
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.right > de.clientWidth + 1)
              .sort((a, b) => b.r.right - a.r.right)
              .slice(0, 4)
              .map((x) => {
                const c = (x.el.getAttribute("class") || "").split(" ").slice(0, 2).join(".");
                return `${x.el.tagName.toLowerCase()}${c ? "." + c : ""} right=${Math.round(x.r.right)} w=${Math.round(x.r.width)}`;
              });
          }
          return { sw: de.scrollWidth, cw: de.clientWidth, off };
        });
        ok(
          dims.sw <= dims.cw + 1,
          `H1 ${w}px ${r} scrollWidth=${dims.sw} ≤ clientWidth+1=${dims.cw + 1}${dims.off.length ? " 「越界：" + dims.off.join(" / ") + "」" : ""}`,
        );
      }
    }

    section("运行时 H2：全档 点击区 ≥24×24（含采纳复选框按最近 label 度量）");
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const r of ["/", "/products", "/opportunities", "/organization"]) {
      await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      const bad = await page.evaluate(() => {
        const out: { sel: string; w: number; h: number }[] = [];
        // 采纳复选框的命中区取最近的 <label class="hermes-inline">（本体已 24px，label 额外兜底）
        const nodes = Array.from(document.querySelectorAll('a, button, [role="button"], label.hermes-inline')) as HTMLElement[];
        for (const el of nodes) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
          if (el.closest("[hidden]")) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.width < 24 || box.height < 24) {
            out.push({ sel: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").split(" ")[0]}`, w: Math.round(box.width), h: Math.round(box.height) });
          }
        }
        return out;
      });
      ok(bad.length === 0, `H2 ${r} 无 <24×24 命中区（实际 ${bad.length}：${bad.slice(0, 6).map((b) => `${b.sel} ${b.w}×${b.h}`).join("；") || "无"}）`);
    }

    section("运行时 H3：≤1100 .project-row 不丢列 + 备有 data-label");
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const rowInfo = await page.evaluate(() => {
      const row = document.querySelector(".project-row") as HTMLElement | null;
      if (!row) return null;
      const cells = Array.from(row.children) as HTMLElement[];
      return {
        hidden: cells.filter((c) => getComputedStyle(c).display === "none").length,
        labels: cells.slice(1, 6).map((c) => c.getAttribute("data-label") || ""),
      };
    });
    if (rowInfo) {
      ok(rowInfo.hidden === 0, `H3 1024 下 .project-row 无 display:none 单元格（实际 ${rowInfo.hidden}）`);
      ok(rowInfo.labels.every((l) => l.length > 0), `H3 第 2–6 单元格均有 data-label（${rowInfo.labels.join("/") || "空"}）`);
    } else {
      console.log("  ℹ /products 无 .project-row（可能为空态），跳过 H3");
    }

    section("运行时 H4：≤860 导航可达（.hermes-nav-item 可见 ≥1）");
    await page.setViewportSize({ width: 860, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const navVisible = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".hermes-nav-item")) as HTMLElement[];
      return items.filter((el) => {
        const box = el.getBoundingClientRect();
        return getComputedStyle(el).display !== "none" && box.width > 0 && box.height > 0;
      }).length;
    });
    ok(navVisible >= 1, `H4 ≤860 可见导航项 ≥1（实际 ${navVisible}）`);

    section("运行时 H8：≤1280 密度档生效（content padding-left ≤24）");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const contentPad = await page.evaluate(() => {
      const el = document.querySelector(".hermes-content") as HTMLElement | null;
      return el ? parseFloat(getComputedStyle(el).paddingLeft) : -1;
    });
    ok(contentPad >= 0 && contentPad <= 24, `H8 1280 下 .hermes-content padding-left ≤24（实际 ${contentPad}）`);
  } finally {
    await browser.close();
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

// ===========================================================================
// 变异验证：证明守卫真的能变红（不是恒绿空断言）
// ===========================================================================
function runMutationChecks() {
  section("变异验证：守卫确实能变红");
  // 守卫 4：一个裸 hex 必须被看见
  const probeCss = ".x { color:#123456; }";
  ok((probeCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length === 1, "颜色收敛守卫能看见裸 hex");
  ok((probeCss.match(/rgba?\([^)]*\)/g) || []).length === 0, "无 rgba 时不误报");
  // 守卫 8：未建档必须命中
  ok(/data-state="not-created"/.test('<div data-state="not-created">未建档</div>'), "未建档断言能命中正确形态");
  ok(!/data-state="not-created"/.test('<div data-state="passed">已通过</div>'), "未建档断言不误伤已通过");
  // 守卫 9：画了点必须被抓到
  ok((('<span class="bubble-dot"></span>'.match(/class="bubble-dot"/g) || []).length) === 1, "气泡点计数能抓到被强制渲染的点");
  // 守卫 13：无来源必须 not ok
  ok(resolveAxis({ value: 100 }).ok === false, "resolveAxis 不会给无依据的值放行");
  // 守卫 3（新·方向反转）：契约守卫必须能抓到"src 引用了不存在的项目类"，且不误伤 Tailwind 工具类
  const fakeCss = new Set(["hermes-shell", "eyebrow"]);
  const fakeTokens = ["hermes-shell", "hermes-typo-not-defined", "eyebrow", "sm:text-lg", "space-y-1", "is-assistant"];
  const flagged = fakeTokens.filter((t) => isProjectToken(t) && !fakeCss.has(t) && !(t in UNSTYLED_HOOKS) && !t.includes("${"));
  ok(flagged.length === 1 && flagged[0] === "hermes-typo-not-defined",
    `契约守卫能抓住未定义的 hermes-* 类、放过已定义类与登记钩子、且排除 Tailwind 工具类（flagged=${flagged.join(",") || "无"}）`);
  // G1：令牌成环必须被抓到，且不误伤「不同名别名」
  ok(findTokenCycles(":root { --probe:var(--probe); }").length === 1,
    "令牌成环守卫能抓到 --probe:var(--probe)");
  ok(findTokenCycles(":root { --ink:var(--ink-muted); }").length === 0,
    "令牌成环守卫不误伤不同名别名（--ink:var(--ink-muted)）");
  // G1 边界（H5）：带 fallback 的同名自引用同样成环
  ok(findTokenCycles(":root { --x:var(--x, #fff); }").length === 1,
    "令牌成环守卫能抓到带 fallback 的自引用（--x:var(--x, #fff)）");
  ok(findTokenCycles(":root { --x:var(--x-more, #fff); }").length === 0,
    "令牌成环守卫不把带 fallback 的不同名别名误判成环（--x:var(--x-more, #fff)）");
  // G2：内联色值必须被抓到（hex / rgb / 函数式颜色）
  const fakeColorSrc = 'const c = { color: "#ff0000", shadow: "rgba(1,2,3,.4)" };';
  ok((fakeColorSrc.match(INLINE_COLOR_RE) || []).length === 2,
    "内联色值守卫能抓到裸 hex 与 rgba");
  // G2 收紧（H4）：函数式颜色必须被抓到（hsl / oklch 曾可逃）
  ok((("hsl(210 100% 50%)".match(INLINE_COLOR_RE) || []).length) === 1,
    "内联色值守卫能抓到 hsl(...)");
  ok((("oklch(0.7 0.1 200)".match(INLINE_COLOR_RE) || []).length) === 1,
    "内联色值守卫能抓到 oklch(...)");
  ok((("color(display-p3 1 0 0)".match(INLINE_COLOR_RE) || []).length) === 1,
    "内联色值守卫能抓到 color(...)");
}

async function main() {
  console.log("=".repeat(80));
  console.log("🧪 Quiet Enterprise 迁移回归锁");
  console.log("=".repeat(80));
  runRenderGuards();
  runMutationChecks();
  await runRuntimeGuards();
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 Quiet Enterprise 回归锁：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ Quiet Enterprise 回归锁：${failures.length} 项未通过（通过 ${passed} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");
}

main()
  .then(() => {
    if (failures.length > 0) process.exitCode = 1;
  })
  .catch((e) => {
    console.error("❌ 回归锁中止:", e?.message || e);
    process.exitCode = 1;
  });
