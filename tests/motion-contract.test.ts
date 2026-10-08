import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * 动效契约（KX-10）：锁定 docs/mcp-kern-experience-roadmap.md §5 的规则。
 *
 * 1. 令牌只在 globals.css 定义一次，数值与规范一致。
 * 2. 含 @keyframes 的样式文件必须有 prefers-reduced-motion 分支。
 * 3. transition 必须写明属性：禁止 all，禁止只写时长的简写（等价于 all）。
 * 4. 只允许动合成层与颜色类属性；尺寸 / 位置动画只允许出现在带 [data-morph] 的选择器上。
 * 5. 单次动画 ≤ 600ms；无限循环只用于「进行中」指示，且必须在下方白名单登记。
 */

const SRC = path.join(process.cwd(), "src");
const GLOBALS = path.join(SRC, "app", "globals.css");

const TOKENS: Record<string, string> = {
  "--m-d-fast": "140ms",
  "--m-d-base": "220ms",
  "--m-d-morph": "560ms",
  "--m-ease-out": "cubic-bezier(.22,1,.36,1)",
  "--m-ease-morph": "cubic-bezier(.32,.72,0,1)",
  "--m-ease-press": "cubic-bezier(.3,0,.5,1)",
  "--m-stagger": "45ms",
};

const ALLOWED_PROPS = new Set([
  "transform",
  "opacity",
  "filter",
  "backdrop-filter",
  "clip-path",
  "color",
  "background",
  "background-color",
  "border-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "box-shadow",
  "visibility",
]);
const LAYOUT_PROPS = /^(width|height|max-width|max-height|min-width|min-height|top|left|right|bottom|inset|margin.*|padding.*|flex-basis|grid-template.*)$/;

/** 表示「进行中」的循环动画。新增前先确认：状态结束时会停，且降动画时信息不丢。 */
const INFINITE_ALLOWLIST = new Set([
  "hermes-think-dot",
  "hermes-think-sweep",
  "hermes-nav-sweep",
  "m-beat",
  "m-sweep",
  "m-breathe",
  "m-blink",
  "m-spin",
  "krPulse",
  "krCaret",
  "kx-live", // kx Notch 的「进行中」圆点；状态结束（done / idle / warn）即停
  "m-shimmer", // Working 骨架灰条；发送结束即卸载，降动画时变静态渐变、文案保留
  "m-flow-travel", // 真实成功上游 → ACTIVE 下游；暂停/断连/隐藏/结束时 data-motion=still
  "m-flow-breathe", // 仅 ACTIVE 节点；同上，降动画时保留全部状态文字
  "m-working-breathe", // 请求等待组件；请求结束卸载，隐藏页面或等待用户时停止
  "m-working-travel", // 同一真实请求的连接线；同上
  "status-pulse", // 面板内「进行中」状态点（worker restarting / 里程碑 running）；
  // 仅在对应状态类名存在时挂载，状态流转（online / done / queued）即随类名移除而停止；
  // 降动画时由文件内 prefers-reduced-motion 分支持续时长归零并锁 iteration-count，状态文字仍在
]);

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out;
}

const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join("/");

/** 扁平规则块（@media 内层同样能取到）：[选择器, 声明] */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([m[1].trim(), m[2]]);
  return out;
}

function decls(body: string, prop: string): string[] {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g");
  return [...body.matchAll(re)].map((m) => m[1].replace(/!important/g, "").trim());
}

function durationsMs(value: string): number[] {
  return [...value.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1])));
}

/** 按顶层逗号切分（忽略 cubic-bezier(...) / var(...) 内的逗号） */
function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

test("MC1：动效令牌在 globals.css 定义且数值与规范一致", () => {
  const css = read(GLOBALS).replace(/\s+/g, " ");
  for (const [name, value] of Object.entries(TOKENS)) {
    const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    assert.ok(m, `globals.css 缺少 ${name}`);
    assert.equal(m[1].replace(/\s+/g, ""), value.replace(/\s+/g, ""), `${name} 应为 ${value}`);
  }
  assert.match(css, /--m-tr-ui\s*:/, "缺少组合令牌 --m-tr-ui");
});

test("MC1b：令牌只定义一次（其他样式文件只能引用，不能重定义）", () => {
  const offenders: string[] = [];
  for (const f of cssFiles(SRC)) {
    if (f === GLOBALS) continue;
    const css = read(f);
    for (const name of [...Object.keys(TOKENS), "--m-tr-ui"]) {
      if (new RegExp(`${name}\\s*:`).test(css)) offenders.push(`${rel(f)} 重定义 ${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("MC2：含 @keyframes 的样式文件必须有 prefers-reduced-motion 分支", () => {
  const offenders = cssFiles(SRC)
    .filter((f) => /@keyframes/.test(read(f)) && !/prefers-reduced-motion/.test(read(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("MC3/MC4：transition 写明属性，只动合成层与颜色类；尺寸动画仅限 [data-morph]", () => {
  const offenders: string[] = [];
  for (const f of cssFiles(SRC)) {
    for (const [selector, body] of rules(read(f))) {
      for (const value of decls(body, "transition")) {
        if (value === "none" || /^var\(--m-tr-ui\)$/.test(value)) continue;
        for (const part of splitTop(value)) {
          const prop = part.split(/\s+/)[0];
          if (prop === "var(--m-tr-ui)") continue;
          if (prop === "all") offenders.push(`${rel(f)} ${selector} → transition: all`);
          else if (/^\d*\.?\d+m?s$/.test(prop)) offenders.push(`${rel(f)} ${selector} → 未写属性（等价于 all）：${value}`);
          else if (LAYOUT_PROPS.test(prop)) {
            if (!selector.includes("[data-morph")) offenders.push(`${rel(f)} ${selector} → 尺寸/位置动画 ${prop}（仅限 [data-morph]）`);
          } else if (!ALLOWED_PROPS.has(prop)) offenders.push(`${rel(f)} ${selector} → 不在允许清单的属性 ${prop}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("MC5：单次动画 ≤ 600ms；无限循环只用于已登记的「进行中」指示", () => {
  const offenders: string[] = [];
  for (const f of cssFiles(SRC)) {
    for (const [selector, body] of rules(read(f))) {
      for (const value of decls(body, "transition")) {
        for (const ms of durationsMs(value)) if (ms > 600) offenders.push(`${rel(f)} ${selector} → transition ${ms}ms`);
      }
      for (const value of decls(body, "animation")) {
        for (const part of splitTop(value)) {
          const name = part.split(/\s+/).find((t) => /^[a-z][\w-]*$/i.test(t) && !/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|alternate|both|forwards|backwards|none|normal|reverse|paused|running)$/.test(t));
          if (/\binfinite\b/.test(part)) {
            if (!name || !INFINITE_ALLOWLIST.has(name)) offenders.push(`${rel(f)} ${selector} → 未登记的循环动画 ${name ?? part}`);
          } else {
            const [duration] = durationsMs(part);
            if (duration !== undefined && duration > 600) offenders.push(`${rel(f)} ${selector} → 动画 ${duration}ms`);
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
