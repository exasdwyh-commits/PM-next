#!/usr/bin/env node
/**
 * audit-css-usage.mjs —— 可复用「死 CSS / 类名契约」审计器（2026-09-18）
 *
 * 目的：为 globals.css 的类名建立**可复现**的三方对账，取代一次性手写扫描：
 *   ① globals.css 里定义了哪些类；
 *   ② src/ 实际引用了哪些（含**动态拼接**，如 `is-${tone}`）；
 *   ③ tests/ + scripts/ 只在配套脚本里引用了哪些。
 * 分类：
 *   - liveInSrc        src 里逐字出现的类（真·在用）
 *   - liveViaTemplate  src 里靠模板串拼接产出的类（逐字扫描会漏，需按生产端值域枚举）
 *   - notInSrc         globals.css 有定义、但 src 完全没用（可能死）
 *   - scriptOnly       notInSrc 中被 tests/scripts 引用（删了会弄坏脚本 → 保留）
 *   - trulyDead        notInSrc 且 tests/scripts 也没引用（可安全删除）
 *
 * 用法：
 *   node scripts/audit-css-usage.mjs                 # 人类可读摘要
 *   node scripts/audit-css-usage.mjs --json          # 机器可读（CI / 对账）
 *   node scripts/audit-css-usage.mjs --globals-only  # 只审计 globals.css（默认含 theme 令牌文件）
 *   node scripts/audit-css-usage.mjs --css a.css --css b.css
 *   node scripts/audit-css-usage.mjs --product-scope # 只把 src/** 当「引用语料」：
 *       一次性过程脚本（scripts/archive/** 恒排除；其余 scripts/_*、tests 等）不计入
 *       「被引用」。产品 CSS 不应为一次性脚本续命（迁移早已入库，这些脚本已过期）。
 *
 * 设计要点：
 *   - 提取 CSS 类前先剥掉 注释 / @import / url(...) / 字符串，避免把 `.css`、`.svg`、`1.5` 误当类名；
 *   - 反向契约：src className 里出现的「项目命名空间」类（hermes-/project-/viz-/bubble-/panel- 等前缀），
 *     必须在 globals.css 有定义；Tailwind 工具类（含变体前缀 `sm:`、数值刻度）不计入。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
// archive/：一次性过程脚本归档区，恒不计入「被引用」（即便非 --product-scope 模式）。
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-verify", ".git", "dist", "coverage", "archive"]);

/* ------------------------------------------------------------------------- *
 * 参数解析
 * ------------------------------------------------------------------------- */
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.startsWith("--css")));
const jsonOut = flags.has("--json");
const globalsOnly = flags.has("--globals-only");
// --product-scope：只把 src/** 当「引用语料」。一次性过程脚本（scripts/_*、tests 等）不计入
// 「被引用」——产品 CSS 不应为一次性脚本续命（迁移早已入库，这些脚本已过期）。
const productScope = flags.has("--product-scope");
const cssArgs = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--css") cssArgs.push(argv[i + 1]);
}
const CSS_FILES = cssArgs.length
  ? cssArgs
  : globalsOnly
    ? ["src/app/globals.css"]
    : ["src/app/globals.css", "src/app/theme/quiet-enterprise.css"];

/* ------------------------------------------------------------------------- *
 * 动态类名生产端（`is-${expr}` 拼接）
 * 逐字扫描**天然看不到**这些类，必须按生产端值域手工登记并附出处。
 * 值域来自 src 中真实的类型定义，见 where 注释；改动生产端时此表须同步。
 * ------------------------------------------------------------------------- */
const DYNAMIC_PRODUCERS = [
  { expr: "status.tone", values: ["ok", "warn", "neutral"], where: "src/components/app-shell.tsx:134（status.tone: ok|warn|neutral）" },
  { expr: "tone", values: ["alert", "good"], where: "src/components/ui.tsx:106（Stat tone?: 'alert'|'good'）" },
  { expr: "t", values: ["ok", "warn", "danger", "info", "neutral", "brand"], where: "src/components/ui.tsx:130（Badge t: Tone = ok|warn|danger|info|neutral|brand）" },
  { expr: "s.state", values: ["done", "current", "pending", "unknown"], where: "src/components/viz.tsx:54（StepState = done|current|pending|unknown）" },
];

/* ------------------------------------------------------------------------- *
 * 工具
 * ------------------------------------------------------------------------- */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 剥掉块注释 + 行注释（保持换行，避免把 `.a  // .b` 连成一行）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** 从一段 CSS 文本里提取所有类名 token。 */
function cssClasses(text) {
  const body = stripComments(text)
    .replace(/@import[^;]*;/g, " ") // @import "x.css"
    .replace(/url\([^)]*\)/g, " ") // url('/x.svg')
    .replace(/"(?:[^"\\]|\\.)*"/g, " ") // 字符串字面量（content/font-family 等）
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
  const set = new Set();
  const re = /\.([a-zA-Z_][\w-]*)/g; // 字母/下划线开头，天然排除 .5em / 1.5fr
  let m;
  while ((m = re.exec(body))) set.add(m[1]);
  return set;
}

/** 从 TS/TSX 源码里提取 className 字符串字面量中的 token（含模板串静态片段）。 */
function classNameTokens(text) {
  const src = stripComments(text);
  const out = new Set();
  const re = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{)/g;
  let m;
  while ((m = re.exec(src))) {
    const direct = m[1] ?? m[2];
    if (direct !== undefined) {
      direct.split(/\s+/).forEach((t) => t && out.add(t));
      continue;
    }
    // { ... } 表达式：按花括号配对取出整段，再取其内部字符串字面量
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      i += 1;
    }
    const expr = src.slice(re.lastIndex, i - 1);
    const litRe = /["'`]([^"'`]*)["'`]/g;
    let lm;
    while ((lm = litRe.exec(expr))) lm[1].split(/\s+/).forEach((t) => t && out.add(t));
  }
  return out;
}

/** 某 token 是否逐字出现在 text 中（按标识符边界，避免 blue⊂blueprint、green⊂--green）。 */
function hasToken(text, token) {
  const re = new RegExp(`(?<![\\w-])${token.replace(/[-]/g, "\\-")}(?![\\w-])`);
  return re.test(text);
}

/* ------------------------------------------------------------------------- *
 * 采集
 * ------------------------------------------------------------------------- */
const cssText = {};
for (const f of CSS_FILES) {
  const abs = join(ROOT, f);
  cssText[f] = existsSync(abs) ? readFileSync(abs, "utf8") : "";
}
const allCss = new Set();
const perFile = {};
for (const f of CSS_FILES) {
  const set = cssClasses(cssText[f]);
  perFile[f] = set.size;
  set.forEach((c) => allCss.add(c));
}

const allFiles = walk(join(ROOT, "src"));
const srcCodeFiles = allFiles.filter((f) => [".ts", ".tsx"].includes(extname(f)));
const srcText = srcCodeFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const srcStripped = stripComments(srcText);

// 证据语料：tests/ + scripts/ 全量（仅用于「逐条对账证据」的展示）。
const evidenceCorpus = [...walk(join(ROOT, "tests")), ...walk(join(ROOT, "scripts"))]
  .filter((f) => [".ts", ".tsx", ".mjs", ".js"].includes(extname(f)))
  // 审计器自身不计入「被脚本引用」——否则它列出的死类会把自己洗成 scriptOnly
  .filter((f) => relative(ROOT, f) !== "scripts/audit-css-usage.mjs");
// 判定语料：--product-scope 时为空（只认 src/**），否则与证据语料一致。
const refFiles = productScope ? [] : evidenceCorpus;
const refText = refFiles.map((f) => readFileSync(f, "utf8")).join("\n");

/** 某 token 在哪些 tests/scripts 文件里出现（用于逐条对账证据）。 */
function evidenceFiles(token) {
  const out = [];
  for (const f of evidenceCorpus) {
    if (hasToken(stripComments(readFileSync(f, "utf8")), token)) out.push(relative(ROOT, f));
  }
  return out.sort();
}

// ① 逐字 live
const liveInSrc = new Set([...allCss].filter((c) => hasToken(srcStripped, c)));

// ② 动态拼接 live：把所有 `is-${expr}` 的出现按生产端值域展开
const liveViaTemplate = new Set();
const dynamicEvidence = {};
for (const p of DYNAMIC_PRODUCERS) {
  const used = new RegExp(`is-\\$\\{\\s*${p.expr.replace(/[.$]/g, (s) => "\\" + s)}\\s*\\}`, "g");
  const usedInSrc = used.test(srcStripped) || used.test(srcText);
  if (!usedInSrc) continue;
  const produced = p.values.map((v) => `is-${v}`);
  dynamicEvidence[p.expr] = { where: p.where, produced };
  for (const cls of produced) if (allCss.has(cls)) liveViaTemplate.add(cls);
}

const live = new Set([...liveInSrc, ...liveViaTemplate]);
const notInSrc = [...allCss].filter((c) => !live.has(c)).sort();

// ③ 脚本/测试引用（判定语料；--product-scope 时为空 → 一切 notInSrc 皆判死）
const referencedInScripts = new Set(notInSrc.filter((c) => hasToken(refText, c)));
const scriptOnly = notInSrc.filter((c) => referencedInScripts.has(c)).sort();
const trulyDead = notInSrc.filter((c) => !referencedInScripts.has(c)).sort();

// ④ 反向契约：src className 里引用的「项目命名空间」类必须在 CSS 有定义
const PROJECT_PREFIX = /^(hermes|project|viz|bubble|panel|decision|hero|detail|metric|owner|row|stage|health|empty|modal|mode|form|compact|user|tiny|star|sparkline|mini|negative|blue|copper|green|muted|date|profile|eyebrow|top|milestone|is)-/;
const PROJECT_BARE = new Set(["eyebrow", "star", "milestone", "negative", "sparkline", "blue", "copper", "green"]);
const isProjectToken = (t) => PROJECT_BARE.has(t) || PROJECT_PREFIX.test(t + "-");

const srcClassTokens = new Set();
for (const f of srcCodeFiles) for (const t of classNameTokens(readFileSync(f, "utf8"))) srcClassTokens.add(t);
// 模板片段（如 `is-${tone}`）已被动态生产端覆盖，不参与反向契约逐个比对
const srcStaticTokens = [...srcClassTokens].filter((t) => !t.includes("${") && !t.includes("`"));

const srcProjectTokens = srcStaticTokens.filter(isProjectToken).sort();
const srcProjectMissing = srcProjectTokens.filter((c) => !allCss.has(c));

/* ------------------------------------------------------------------------- *
 * 输出
 * ------------------------------------------------------------------------- */
const report = {
  scope: productScope ? "product (src/** only)" : "default (src + tests + scripts)",
  cssFiles: CSS_FILES,
  cssClassesPerFile: perFile,
  cssClassTotal: allCss.size,
  liveInSrc: liveInSrc.size,
  liveViaTemplate: liveViaTemplate.size,
  liveTotal: live.size,
  notInSrc: notInSrc.length,
  scriptOnly: scriptOnly.length,
  trulyDead: trulyDead.length,
  trulyDeadList: trulyDead,
  scriptOnlyList: scriptOnly,
  scriptOnlyEvidence: Object.fromEntries(scriptOnly.map((c) => [c, evidenceFiles(c)])),
  trulyDeadEvidence: Object.fromEntries(trulyDead.map((c) => [c, evidenceFiles(c)])),
  liveViaTemplateList: [...liveViaTemplate].sort(),
  dynamicProducers: dynamicEvidence,
  reverseContract: {
    srcClassTokensTotal: srcClassTokens.size,
    srcProjectTokens: srcProjectTokens.length,
    missingInCss: srcProjectMissing,
    missingSrcEvidence: Object.fromEntries(
      srcProjectMissing.map((c) => [c, srcCodeFiles.filter((f) => hasToken(readFileSync(f, "utf8"), c)).map((f) => relative(ROOT, f))]),
    ),
  },
};

if (jsonOut) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const L = [];
  L.push(`范围: ${report.scope}`);
  L.push(`CSS 文件: ${CSS_FILES.join(", ")}`);
  L.push(`  每文件类数: ${Object.entries(perFile).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  L.push(``);
  L.push(`CSS class 总数        : ${report.cssClassTotal}`);
  L.push(`  ├ src 逐字引用(live) : ${report.liveInSrc}`);
  L.push(`  ├ 模板拼接(live)     : ${report.liveViaTemplate}  ${report.liveViaTemplateList.join(", ")}`);
  L.push(`  └ 未被 src 引用      : ${report.notInSrc}`);
  L.push(`       ├ 仅脚本引用    : ${report.scriptOnly}`);
  L.push(`       └ 真死          : ${report.trulyDead}`);
  L.push(``);
  L.push(`真死清单(${trulyDead.length}): ${trulyDead.join(", ")}`);
  L.push(`仅脚本引用(${scriptOnly.length}): ${scriptOnly.join(", ")}`);
  L.push(``);
  L.push(`反向契约: src 项目命名空间类 ${report.reverseContract.srcProjectTokens} 个，CSS 未定义 ${srcProjectMissing.length} 个: ${srcProjectMissing.join(", ") || "无"}`);
  process.stdout.write(L.join("\n") + "\n");
}
