#!/usr/bin/env node
/**
 * 一次性迁移脚本：把 globals.css 里全部字面量 hex/rgba 替换为 Quiet Enterprise 语义令牌。
 * 保留全部选择器 / 类名 / 属性名，只改 `:` 右侧的值。
 * 运行后应满足：globals.css（去注释）unique hex/rgba = 0。
 *
 * 用法：node scripts/_tokenize-quiet-enterprise.mjs
 */
import fs from "fs";
import path from "path";

const FILE = path.resolve(process.cwd(), "src/app/globals.css");
let src = fs.readFileSync(FILE, "utf8");

// ---------------------------------------------------------------------------
// 1) 顶部：注入令牌层 @import（必须早于 @tailwind 与所有规则）
// ---------------------------------------------------------------------------
src = src.replace(/^/, '@import "./theme/quiet-enterprise.css";\n');

// ---------------------------------------------------------------------------
// 2) 旧 :root 定义 → 兼容块（令牌层已定义同名兼容别名，这里只保留 var 引用）
// ---------------------------------------------------------------------------
src = src.replace(
  /:root \{ --ink:#0d1b29;[^}]*\}/,
  ":root { --ink:var(--ink); --muted:var(--ink-muted); --paper:var(--bg); --line:var(--line); --teal:var(--accent); --copper:var(--warn-ink); --green:var(--ok); }"
);

// ---------------------------------------------------------------------------
// 3) 结构级替换：壳层纯色化 / 侧栏转浅色 / hero 转浅色 / 移除照片墙
// ---------------------------------------------------------------------------
src = src.replace(
  /\.hermes-shell \{[^}]*\}/,
  ".hermes-shell { min-height:100vh; display:flex; position:relative; background:var(--bg); }"
);
src = src.replace(/\.hermes-shell::before \{[^}]*\}/, "");
src = src.replace(/@keyframes wallpaper-drift \{[^}]*\}\s*/, "");

src = src.replace(
  /\.hermes-sidebar \{[^}]*\}/,
  ".hermes-sidebar { width:var(--sidebar); min-height:100vh; padding:20px 14px 18px; color:var(--ink); background:var(--surface); border-right:1px solid var(--line); position:relative; z-index:1; display:flex; flex-direction:column; box-shadow:var(--shadow-soft); }"
);

// hero：参考包浅色 hero（浅底 + 山景水印水印 + 保留既有子类）
src = src.replace(
  /\.hermes-hero \{[^}]*\}/,
  ".hermes-hero { min-height:180px; margin:0 0 14px; position:relative; overflow:hidden; border-radius:var(--radius); border:1px solid var(--line); color:var(--ink); background:var(--surface) url('/mountains.svg') right center/70% 100% no-repeat; box-shadow:var(--shadow-soft); }"
);
src = src.replace(
  /\.hero-image \{[^}]*\}/,
  ".hero-image { position:absolute; inset:0; background:linear-gradient(90deg,var(--surface) 0%,var(--surface-glass) 34%,transparent 72%); transition:transform .8s ease; }"
);

// 侧栏导航激活态：浅底上用 accent-bg + accent-hover（替代深底高光）
src = src.replace(
  /\.hermes-nav-item:hover,\.hermes-nav-item\.is-active \{[^}]*\}/,
  ".hermes-nav-item:hover,.hermes-nav-item.is-active { color:var(--accent-hover); background:var(--accent-bg); border-color:var(--accent-line); transform:translateX(2px); }"
);

// 头像：铜色渐变 → 蓝系
 
src = src.replace(
  /\.hermes-avatar,\.user-chip-avatar,\.tiny-avatar \{[^}]*\}/,
  ".hermes-avatar,.user-chip-avatar,.tiny-avatar { display:grid; place-items:center; border-radius:50%; color:var(--navy); background:linear-gradient(145deg,var(--accent-bg),var(--accent-ring)); }"
);

// monogram / 登录 monogram：铜字 → navy
src = src.replace(/color:#d6b08a;/g, "color:var(--navy);");
src = src.replace(/color:#b98a5f;/g, "color:var(--navy);");

// 登录页：移除照片墙 ::before，背景取纯色
src = src.replace(/\.hermes-login::before \{[^}]*\}/, "");
src = src.replace(
  /\.hermes-login \{[^}]*\}/,
  ".hermes-login { min-height:100vh; display:grid; place-items:center; padding:24px; position:relative; background:var(--bg); }"
);

// 内容宽度 / 侧栏宽度 / 顶栏高度 → 令牌几何
src = src.replace(/width:calc\(100% - 190px\)/g, "width:calc(100% - var(--sidebar))");
src = src.replace(/\.hermes-sidebar \{ width:190px;/g, ".hermes-sidebar { width:var(--sidebar);");

// 顶栏：68px 吸顶 + 毛玻璃（原生 backdrop-filter，回退纯色）
src = src.replace(
  /\.hermes-topbar \{ height:56px;[^}]*\}/,
  ".hermes-topbar { height:var(--topbar); padding:8px 16px 8px 20px; border-radius:0; position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; background:var(--surface-glass); border-bottom:1px solid var(--line); backdrop-filter:blur(14px) saturate(125%); -webkit-backdrop-filter:blur(14px) saturate(125%); }"
);

// ---------------------------------------------------------------------------
// 4) 断点合并：侧栏宽度/内容宽度集中到 1180/860，800 只留与侧栏无关的规则
// ---------------------------------------------------------------------------
src = src.replace(
  /@media \(max-width:1100px\) \{/,
  `@media (max-width:1180px) {
  .hermes-sidebar { width:var(--sidebar-rail); padding:18px 8px; }
  .hermes-brand .hermes-wordmark,.hermes-brand .hermes-submark,.hermes-nav-item span,.hermes-sidebar-bottom div:last-child,.hermes-profile div:nth-child(2),.profile-chevron,.hermes-nav-divider span { display:none; }
  .hermes-monogram { font-size:40px; }
  .hermes-nav-item { justify-content:center; padding:0; }
  .hermes-nav-item.is-active i { left:-8px; }
  .hermes-content { width:calc(100% - var(--sidebar-rail)); }
}
@media (max-width:860px) {
  .hermes-sidebar { display:none; }
  .hermes-content { width:100%; padding:16px 14px 40px; }
  .hermes-topbar { position:static; }
}
@media (max-width:1100px) {`
);
// ≤800 块：移除侧栏/内容宽度声明（已上移到 1180/860）
src = src.replace(/\.hermes-sidebar \{ width:72px; padding:18px 8px; \}/, "");
src = src.replace(/\.hermes-content \{ width:calc\(100% - 72px\); padding:14px; \}/, "");

// ---------------------------------------------------------------------------
// 5) 逐值替换：hex（正则，避免 #fff 命中 #fff0eb 之类）+ rgba（精确子串）
// ---------------------------------------------------------------------------
const hexMap = {
  "#0d1b29": "--ink",
  "#263842": "--ink-2", "#4d5c61": "--ink-2", "#4f5f66": "--ink-2", "#516269": "--ink-2",
  "#52656c": "--ink-2", "#5b696e": "--ink-2", "#5f6e75": "--ink-2", "#64737a": "--ink-2",
  "#69747b": "--ink-2", "#6d7b80": "--ink-2", "#c4d1d3": "--ink-2",
  "#708087": "--ink-muted", "#76808a": "--ink-muted", "#7d898e": "--ink-muted",
  "#78858a": "--ink-muted", "#7a858a": "--ink-muted", "#829094": "--ink-muted", "#7e898e": "--ink-muted",
  "#849095": "--ink-faint", "#859095": "--ink-faint", "#8a9698": "--ink-faint", "#8a9799": "--ink-faint",
  "#8c999b": "--ink-faint", "#91a0a1": "--ink-faint", "#98a2a5": "--ink-faint", "#9aa4a5": "--ink-faint",
  "#9aa4a6": "--ink-faint", "#a9b3b6": "--ink-faint", "#738084": "--ink-faint", "#7c8e93": "--ink-faint",
  "#6f7d82": "--ink-faint", "#91a2a5": "--ink-faint", "#8d9c9f": "--ink-faint", "#d7e3e3": "--ink-faint",
  "#e8f2f1": "--ink", "#8d7663": "--ink-faint",
  // surface / 状态底
  "#fff": "--surface", "#eeece5": "--bg", "#fdf3e3": "--warn-bg", "#fcf0e7": "--warn-bg",
  "#e9f5fd": "--accent-bg", "#e5f5fb": "--accent-bg", "#e4f5fa": "--accent-bg",
  "#e8f8f2": "--ok-bg", "#e6f7f1": "--ok-bg", "#bfe8dc": "--ok-line",
  "#fdeeea": "--block-bg", "#fff0eb": "--block-bg", "#e7b5a8": "--block-line", "#f2cdc4": "--block-line",
  "#f0dcb6": "--warn-line", "#ecd9a8": "--warn-line", "#eceeeb": "--neutral-bg", "#dbe0dd": "--neutral-line",
  "#d8dedf": "--line-strong",
  // 绿
  "#0c9b78": "--ok", "#0d9b7a": "--ok", "#0d9b78": "--ok", "#159d7c": "--ok", "#21ad8b": "--ok",
  "#25a27f": "--ok", "#13aa7b": "--ok", "#2ce7bf": "--ok", "#0c7a5f": "--ok-ink",
  // 暖
  "#bd8154": "--warn", "#ca8c59": "--warn", "#dba445": "--warn", "#e8b04b": "--warn",
  "#a96641": "--warn-ink", "#8a6320": "--warn-ink", "#8a6212": "--warn-ink", "#b9784d": "--warn-ink",
  "#d3a17c": "--warn-line", "#f5d4a6": "--warn-line", "#dcb28b": "--warn-line", "#d4ae86": "--warn-line",
  "#d6b08a": "--warn-line", "#7a4d41": "--warn-ink", "#b98a5f": "--warn-ink",
  // 红
  "#9e4636": "--block-ink", "#9e4c3d": "--block-ink", "#a8523f": "--block-ink", "#b42318": "--block-ink",
  "#d94b4b": "--block",
  // 蓝 / teal
  "#075b72": "--accent-hover", "#0c6b88": "--accent-hover", "#0c5b70": "--accent-hover",
  "#0d6d86": "--accent-hover", "#0a5068": "--accent-hover", "#08657d": "--accent-hover",
  "#07445b": "--accent-hover", "#0a6b86": "--accent-hover", "#0a4f60": "--accent-hover",
  "#0b5269": "--navy",
  "#15728b": "--accent", "#08719a": "--accent", "#237eb9": "--accent", "#0e97b8": "--accent",
  "#14bfe9": "--accent-ring", "#2aaac4": "--accent-ring", "#1ba1bd": "--accent-ring",
  "#4da8da": "--accent-ring", "#35d7ff": "--accent-ring", "#35a8c4": "--accent-ring", "#0c7c9b": "--accent-ring",
  "#0a171d": "--navy", "#07171f": "--navy", "#0d2026": "--navy", "#0c222b": "--navy",
};
for (const [hex, tok] of Object.entries(hexMap)) {
  const re = new RegExp(hex.replace("#", "\\#") + "(?![0-9a-fA-F])", "g");
  src = src.replace(re, `var(${tok})`);
}

const rgbaMap = {
  "rgba(39,61,72,.13)": "--line",
  "rgba(36,66,74,.08)": "--line-soft", "rgba(36,66,74,.1)": "--line-soft",
  "rgba(25,65,76,.13)": "--line-strong", "rgba(30,67,78,.16)": "--line-field",
  "rgba(18,48,61,.1)": "--line",
  "rgba(255,255,255,.14)": "--line", "rgba(255,255,255,.12)": "--line", "rgba(255,255,255,.08)": "--line",
  "rgba(255,255,255,0.92)": "--surface-glass", "rgba(255,255,255,.94)": "--surface-glass",
  "rgba(255,255,255,.9)": "--surface-glass", "rgba(255,255,255,.8)": "--surface-glass",
  "rgba(255,255,255,.72)": "--surface-glass", "rgba(255,255,255,0.8)": "--surface-glass",
  "rgba(255,255,255,.7)": "--surface-wash", "rgba(255,255,255,.6)": "--surface-wash",
  "rgba(255,255,255,.57)": "--surface-wash", "rgba(255,255,255,.55)": "--surface-wash",
  "rgba(255,255,255,.5)": "--surface-wash", "rgba(255,255,255,.45)": "--surface-wash",
  "rgba(255,255,255,.42)": "--surface-wash",
  "rgba(255,255,255,.35)": "--surface-faint", "rgba(255,255,255,.34)": "--surface-faint",
  "rgba(255,255,255,.28)": "--surface-faint", "rgba(255,255,255,.2)": "--surface-faint",
  "rgba(255,255,255,.15)": "--surface-faint",
  "rgba(248,249,247,.45)": "--surface-wash",
  "rgba(24,42,49,.08)": "--shadow", "rgba(15,41,49,.2)": "--shadow",
  "rgba(5,91,119,.2)": "--shadow-accent", "rgba(5,91,119,.3)": "--shadow-accent",
  "rgba(11,32,40,.12)": "--shadow-soft", "rgba(15,40,50,.12)": "--shadow-soft",
  "rgba(5,20,28,.46)": "--overlay",
  "rgba(7,91,114,.33)": "--accent-line", "rgba(7,91,114,.25)": "--accent-line",
  "rgba(7,91,114,.2)": "--accent-line", "rgba(7,91,114,.18)": "--accent-line",
  "rgba(7,91,114,.1)": "--accent-wash", "rgba(7,91,114,.06)": "--accent-wash",
  "rgba(16,133,165,.4)": "--accent-line", "rgba(16,133,165,.42)": "--accent-line",
  "rgba(16,133,165,.34)": "--accent-line", "rgba(16,133,165,.3)": "--accent-line",
  "rgba(16,133,165,.28)": "--accent-line", "rgba(16,133,165,0.28)": "--accent-line",
  "rgba(16,133,165,.24)": "--accent-line",
  "rgba(16,133,165,.09)": "--accent-wash", "rgba(16,133,165,0.09)": "--accent-wash",
  "rgba(16,133,165,.08)": "--accent-wash", "rgba(16,133,165,.07)": "--accent-wash",
  "rgba(16,133,165,.06)": "--accent-wash", "rgba(16,133,165,0.06)": "--accent-wash",
  "rgba(13,82,101,.2)": "--accent-wash", "rgba(49,194,226,.42)": "--accent-ring",
  "rgba(27,161,189,.11)": "--accent-ring", "rgba(12,107,136,.12)": "--accent-wash",
  "rgba(12,107,136,.28)": "--accent-line",
  "rgba(222,246,250,.75)": "--accent-bg", "rgba(228,245,250,.86)": "--accent-bg",
  "rgba(228,245,250,.6)": "--accent-bg", "rgba(219,242,248,.8)": "--accent-bg",
  "rgba(221,242,248,.72)": "--accent-wash", "rgba(221,242,248,.5)": "--accent-wash",
  "rgba(221,242,248,.35)": "--accent-wash", "rgba(53,168,196,.14)": "--accent-line",
  "rgba(19,170,123,.5)": "--ok-line", "rgba(44,231,191,.12)": "--ok-line",
  "rgba(232,248,242,.86)": "--ok-bg", "rgba(253,246,229,.9)": "--warn-bg",
  "rgba(232,176,75,.14)": "--warn-line", "rgba(232,176,75,0.35)": "--warn-line",
  "rgba(217,75,75,0.35)": "--block-line", "rgba(217,75,75,.32)": "--block-line",
  "rgba(255,240,235,.7)": "--block-bg", "rgba(240,249,252,0.85)": "--surface-2",
  "rgba(139,155,160,.14)": "--neutral-line",
  "rgba(244,242,235,.48)": "--surface-wash", "rgba(244,242,235,.08)": "--surface-wash",
  "rgba(244,242,235,.28)": "--surface-wash", "rgba(245,244,239,.72)": "--bg",
  "rgba(232,231,223,.86)": "--bg", "rgba(255,255,255,.98)": "--surface",
  "rgba(5,26,34,.9)": "--navy", "rgba(5,26,34,.48)": "--navy", "rgba(5,26,34,.1)": "--navy",
  "rgba(225,183,133,.6)": "--warn-line", "rgba(224,239,236,.3)": "--line",
};
const rgbaKeys = Object.keys(rgbaMap).sort((a, b) => b.length - a.length);
for (const k of rgbaKeys) {
  src = src.split(k).join(`var(${rgbaMap[k]})`);
}

fs.writeFileSync(FILE, src);

// ---------------------------------------------------------------------------
// 6) 复算：去注释后 unique hex/rgba 必须为 0
// ---------------------------------------------------------------------------
const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
const hex = clean.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
const rgb = clean.match(/rgba?\([^)]*\)/g) || [];
console.log("after: hex", hex.length, "uniq", new Set(hex.map((h) => h.toLowerCase())).size);
console.log("after: rgba", rgb.length, "uniq", new Set(rgb.map((r) => r.replace(/\s+/g, "").toLowerCase())).size);
console.log("leftover hex:", [...new Set(hex)].slice(0, 60));
console.log("leftover rgba:", [...new Set(rgb)].slice(0, 60));
