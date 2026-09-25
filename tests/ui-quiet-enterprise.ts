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
  "hermes-brief-situation": "工作台『现在的情况』分段容器：仅作语义分节，视觉由 .hermes-brief-* 子元素承担",
  "hermes-brief-decisions": "工作台『需要你决定』分段容器：同上，有意不加自身样式",
  "hermes-brief-themes": "工作台『其他工作』分段容器：同上，有意不加自身样式",
  "project-list": "产品列表包裹层：布局交由 .project-table-head / .project-row 网格承担",
  "is-assistant": "顾问对话『非本人』消息的状态标记：默认样式即基线，仅 is-user 需要覆盖，故无自身规则",
};

/** 项目命名空间前缀（设计系统自建类），用于把 Tailwind 工具类排除在契约之外。 */
const PROJECT_PREFIX =
  /^(hermes|project|viz|bubble|panel|decision|hero|detail|metric|owner|row|stage|health|empty|modal|mode|form|compact|user|tiny|star|sparkline|mini|negative|blue|copper|green|muted|date|profile|eyebrow|top|milestone|is)-/;
const PROJECT_BARE = new Set(["eyebrow", "star", "milestone", "negative", "sparkline", "blue", "copper", "green"]);
const isProjectToken = (t: string) => PROJECT_BARE.has(t) || PROJECT_PREFIX.test(t + "-");

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

  section("源码守卫 3：类名契约（src className 引用的项目类必须在 globals.css 有定义）");
  const cssClean = css
    .replace(/@import[^;]*;/g, " ")
    .replace(/url\([^)]*\)/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ");
  const cssClassSet = new Set((cssClean.match(/\.([a-zA-Z_][\w-]*)/g) || []).map((s) => s.slice(1)));
  const refTokens = [...srcClassNameTokens()].filter((t) => !t.includes("${") && isProjectToken(t)).sort();
  const undefinedTokens = refTokens.filter((c) => !cssClassSet.has(c));
  ok(undefinedTokens.every((c) => c in UNSTYLED_HOOKS),
    `src 引用的 ${refTokens.length} 个项目类名里，CSS 未定义的只应是已登记的「无样式钩子」（实际 ${undefinedTokens.length}：${undefinedTokens.join(", ") || "无"}）`);
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
  const isColorExcluded = (f: string) => {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    return COLOR_GUARD_EXCLUDE.some((p) => rel.includes(p));
  };
  const tsFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
  const colorScanned = tsFiles.filter((f) => !isColorExcluded(f));
  const colorExcluded = tsFiles.filter(isColorExcluded).map((f) => path.relative(process.cwd(), f)).sort();
  const colorHits: string[] = [];
  for (const f of colorScanned) {
    const hits = stripComments(fs.readFileSync(f, "utf8")).match(INLINE_COLOR_RE) || [];
    if (hits.length) colorHits.push(`${path.relative(process.cwd(), f)} → ${[...new Set(hits)].join(",")}`);
  }
  ok(
    colorHits.length === 0,
    `src .ts/.tsx 内联色值（hex / rgb|hsl|oklch… 函数式）= 0（实际 ${colorHits.length}：${colorHits.slice(0, 6).join(" | ") || "无"}）`,
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
  const mediaWidths = [...css.matchAll(/@media \(max-width:(\d+)px\)/g)].map((m) => Number(m[1]));
  const descending = mediaWidths.every((n, i) => i === 0 || n <= mediaWidths[i - 1]);
  ok(mediaWidths.length >= 7 && descending,
    `max-width 媒体查询按由宽到窄声明（实际 ${mediaWidths.join(" → ") || "无"}）`);
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
