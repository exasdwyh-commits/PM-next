// 一次性静态扫描（仅诊断，非产品代码）：判定 globals.css 的死类 + 反向契约缺口。
// 修 v2：正确提取「复合选择器的尾类」（如 .hermes-nav-item.is-active 的两个类）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const CSS_FILES = ["src/app/globals.css", "src/app/theme/quiet-enterprise.css"];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

function cssClasses(text) {
  let body = text
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 注释
    .replace(/@import[^;]*;/g, " ") // @import
    .replace(/url\([^)]*\)/g, " "); // url(...) —— 去掉 .svg/.png 干扰
  const set = new Set();
  const re = /\.([a-zA-Z_][\w-]*)/g; // 无 lookbehind：连写 .a.b 两个都抓到
  let m;
  while ((m = re.exec(body))) set.add(m[1]);
  return set;
}

function classNameLiterals(text) {
  const out = new Set();
  const re = /className\s*=\s*(?:"([^"]*)"|\{)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      m[1].split(/\s+/).forEach((t) => t && out.add(t));
      continue;
    }
    let i = re.lastIndex;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const expr = text.slice(re.lastIndex, i - 1);
    const litRe = /["'`]([^"'`]*)["'`]/g;
    let lm;
    while ((lm = litRe.exec(expr))) lm[1].split(/\s+/).forEach((t) => t && out.add(t));
  }
  return out;
}

function presence(text, classes) {
  const hit = new Set();
  for (const c of classes) {
    const re = new RegExp(`(?<![\\w-])${c.replace(/[-]/g, "\\-")}(?![\\w-])`);
    if (re.test(text)) hit.add(c);
  }
  return hit;
}

let css = "";
for (const f of CSS_FILES) css += "\n" + readFileSync(join(ROOT, f), "utf8");
const allCss = cssClasses(css);

const allFiles = walk(join(ROOT, "src"));
const srcCode = allFiles.filter((f) => [".ts", ".tsx"].includes(extname(f)));
const srcText = srcCode.map((f) => readFileSync(f, "utf8")).join("\n");

const testFiles = [...walk(join(ROOT, "tests")), ...walk(join(ROOT, "scripts"))];
const testText = testFiles.map((f) => readFileSync(f, "utf8")).join("\n");

const liveInSrc = presence(srcText, allCss);
const liveInTest = presence(testText, allCss);

const dead = [...allCss].filter((c) => !liveInSrc.has(c)).sort();
const scriptOnly = dead.filter((c) => liveInTest.has(c)).sort();
const trulyDead = dead.filter((c) => !liveInTest.has(c)).sort();

// 反向契约：src className 字面量里的「设计系统命名空间」类，但 CSS 未定义
const DS = /^(hermes|project|viz|bubble|panel|decision|hero|detail|metric|user-chip|owner-cell|row-index|milestone|empty-state|modal-actions|mode-switch|form-error)(-|$)/;
const srcLits = new Set();
for (const f of srcCode) for (const t of classNameLiterals(readFileSync(f, "utf8"))) srcLits.add(t);
const clean = (t) => /^[a-zA-Z][\w-]*$/.test(t);
const srcMissingDs = [...srcLits].filter(clean).filter((c) => DS.test(c)).filter((c) => !allCss.has(c)).sort();

const rep = {
  cssClassTotal: allCss.size,
  liveInSrc: liveInSrc.size,
  notInSrc: dead.length,
  scriptOnly: scriptOnly.length,
  trulyDead: trulyDead.length,
  trulyDeadList: trulyDead,
  scriptOnlyList: scriptOnly,
  srcMissingDesignSystem: srcMissingDs,
};
console.log(JSON.stringify(rep, null, 2));
