import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * G3 · 主题配对守卫：**同一规则内，背景与文字必须同源。**
 *
 * ## 为什么加这条
 *
 * 2026-10-14 用户截图：角色视图里有一档浅蓝底 + 近白字，暗色模式下对比度约 1.1:1，
 * 整块内容读不出来。根因不是「忘了用令牌」，而是**配对只改了一半**：
 * 背景写死 `#eaf1fe`（永远浅），文字走令牌（随主题翻白）→ 暗色下浅底浅字。
 * 修完那一处后，同类结构在仓库里还有一批存量。
 *
 * 既有守卫抓不到它：`tests/ui-quiet-enterprise.ts` 的「内联色值 = 0」只扫 `.ts/.tsx`
 * （`walk(SRC).filter(f => /\.(ts|tsx)$/)`），**任何 .css 文件里的字面色值都没有守卫看着**，
 * 这正是这个 bug 能活很久、且修完还能悄悄回退的原因。
 *
 * ## 判据（确定性，不含主观判断）
 *
 * 取出每个 CSS 规则块里的 `background`/`background-color` 与 `color`，各自定性为
 * `token`（含 `var(--x)`）或 `literal`（hex / 函数式颜色 / 少量具名色）。**两者不同源即上报。**
 * - `var(--x, #fff)` 以令牌为准：fallback 只是兜底，不构成「固定色」，因此不算不同源。
 * - `transparent / none / inherit / currentColor / unset / initial / revert / auto` 不参与定性。
 * - 只看**同一条规则内**的配对。跨规则的情形（父元素负责底、子元素负责字，例如
 *   `.kpi.brand` 的底 + `.kpi.brand strong` 的字）**本条守卫不覆盖** —— 诚实登记为已知未覆盖面，
 *   那类问题目前靠 `docs/reports/contrast-audit-*.md` 的人工实测（明暗两态各量一次）。
 *
 * ## 登记表语义（重要）
 *
 * 上报的每一处都必须在 `REGISTERED` 里写明理由。`status` 是**人的判断**，不是计算结果：
 * - `suspect`：底用「表面/文字」令牌（会随主题翻明暗）、或半透明白底，而文字是固定色 →
 *   **与用户截图同一 bug 类**，待修。
 * - `accepted`：底是语义实色（状态绿/红、品牌色等）+ 固定反白/反深 → 结构上稳定。
 *   注意：`accepted` **不等于已实测达标**，只表示「不是本守卫要抓的那类结构」；
 *   逐条对比度仍需人工量（见审计报告）。
 *
 * 新增一处不同源配对会让本测试变红（防新债）；登记表里已消失的条目只提示、不判失败
 * （收窄方向不设卡，避免修缺陷的人被登记表反咬）。
 */

const SRC = path.resolve(process.cwd(), "src");
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-verify", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".css")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** 只剥 `/* *\/` 块注释：CSS 里 `//` 不是注释，剥了会误伤 `url(http://…)`。 */
const stripCssComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const LEAF_BLOCK_RE = /([^{}]*)\{([^{}]*)\}/g;
const DECL_RE = /(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/gi;
const VAR_RE = /var\(\s*(--[A-Za-z0-9-]+)/;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const FUNC_COLOR_RE = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
const NAMED_COLOR_RE = /\b(?:white|black|gray|grey|silver|whitesmoke|ivory|beige|snow)\b/;
const IGNORE_VALUE_RE = /^(?:transparent|none|inherit|currentcolor|unset|initial|revert|auto)$/i;

type ColorSource = "token" | "literal";

function colorSource(value: string): ColorSource | null {
  const v = value.trim().toLowerCase();
  if (!v || IGNORE_VALUE_RE.test(v)) return null;
  if (VAR_RE.test(v)) return "token";
  if (HEX_RE.test(v) || FUNC_COLOR_RE.test(v) || NAMED_COLOR_RE.test(v)) return "literal";
  return null;
}

type Pair = {
  key: string;
  file: string;
  selector: string;
  background: string;
  foreground: string;
  tokens: string[];
};

const files = walk(SRC).sort();
const pairs: Pair[] = [];
for (const file of files) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  const text = stripCssComments(fs.readFileSync(file, "utf8"));
  for (const block of text.matchAll(LEAF_BLOCK_RE)) {
    const selector = block[1].split(/\s+/).filter(Boolean).join(" ");
    let background: string | null = null;
    let foreground: string | null = null;
    for (const decl of `;${block[2]}`.matchAll(DECL_RE)) {
      const property = decl[1].toLowerCase();
      if (background === null && (property === "background" || property === "background-color")) background = decl[2];
      else if (foreground === null && property === "color") foreground = decl[2];
    }
    if (background === null || foreground === null) continue;
    const bgSource = colorSource(background);
    const fgSource = colorSource(foreground);
    if (bgSource === null || fgSource === null || bgSource === fgSource) continue;
    const tokenSource = bgSource === "token" ? background : foreground;
    pairs.push({
      key: `${rel} :: ${selector}`,
      file: rel,
      selector,
      background: background.trim().replace(/\s+/g, " "),
      foreground: foreground.trim().replace(/\s+/g, " "),
      tokens: [...new Set([...tokenSource.matchAll(new RegExp(VAR_RE.source, "g"))].map((m) => m[1]))],
    });
  }
}
pairs.sort((a, b) => a.key.localeCompare(b.key));

/**
 * 登记表。新增条目请在 `why` 里写清「为什么这个配对在明暗两态下都成立」，
 * 而不是只写「已知问题」——登记表一旦变成收容所，守卫就失去意义。
 */
const REGISTERED: Record<string, { status: "suspect" | "accepted"; why: string }> = {
  // ---- 2026-10-16 存量清零记录（条目已删除，此处留修法依据，不是登记表）----
  // 已修（底与字改为两边同走令牌，守卫不再命中）：
  //   response-role.css :: .rb-other-lead / .rb-dec-head .conf —— CSS 侧早已改完，登记表未同步
  //   design-tokens.css :: .btn-beautified.primary —— 底 --color-ink（暗色翻浅）→ --deep，字 white → --on-dark
  //   executive-report-role.css :: .err-role / .err-table-full th / .err-stats / .err-sales-script p
  //     —— 半透明白底 rgba(255,255,255,.x) / rgba(241,245,250,.x) → --er-surface-2 / --er-sunk

  // 改判（未改 CSS；底所在令牌在容器上局部写死，不随主题翻转 → 底恒深，固定反白字恒可读）
  "src/app/muse/response/response-v2.css :: .kr2-view-switch button.is-active": {
    status: "accepted",
    why: "--k-ink 不是全局令牌，而是在 .kr2-response 上局部写死 #0f1116（response-v2.css:3），本文件无 prefers-color-scheme 块，元素自身声明优先于 :root 继承 → 底恒深。与 .ws .ws-primary 同类",
  },
  "src/components/report-v3.css :: .rv3 .chip.on": {
    status: "accepted",
    why: "--ink 在 .rv3 上局部写死 #1C1A17（report-v3.css:4），本文件全文无 prefers-color-scheme 块 → 底恒深，固定 #F6F1E6 字恒可读。与 .m-planlist 同类",
  },

  // ---- accepted：语义实色底 + 固定反白/反深（结构稳定；未逐条实测对比度）----
  "src/app/muse/muse.css :: .m-node[data-s=\"success\"]": {
    status: "accepted",
    why: "状态徽标：--m-ok 实色底 + 固定白字，底不会翻成浅色",
  },
  "src/app/muse/muse.css :: .m-node[data-s=\"error\"]": {
    status: "accepted",
    why: "状态徽标：--m-bad 实色底 + 固定白字，同上",
  },
  "src/app/muse/muse.css :: .m-planlist li[data-kind=\"SYNTHESIS\"] .m-planlist-n": {
    status: "accepted",
    why: "步骤序号：--m-grad 渐变底 + 固定白字；该令牌未在暗色块内重定义（实测）",
  },
  "src/app/muse/rich/rich.css :: .kxr-tl li[data-s=\"done\"] .kxr-tl-node": {
    status: "accepted",
    why: "时间线已完成节点：--kxr-ok 实色底 + 固定白字",
  },
  "src/components/executive-report-role.css :: .lvl.A": { status: "accepted", why: "等级徽标：--er-ok 实色底 + 固定白字" },
  "src/components/executive-report-role.css :: .lvl.B": { status: "accepted", why: "等级徽标：--er-brand 实色底 + 固定白字" },
  "src/components/executive-report-role.css :: .lvl.C": { status: "accepted", why: "等级徽标：--er-warn 实色底 + 固定白字" },
  "src/components/executive-report-role.css :: .lvl.D": { status: "accepted", why: "等级徽标：--er-bad 实色底 + 固定白字" },
  "src/components/kx/kx.css :: .kx-footer-mark": { status: "accepted", why: "品牌印记：--k-brand 实色底 + 固定白字" },
  "src/components/kx/kx.css :: .kx-notch-mark": { status: "accepted", why: "品牌印记：--k-brand 实色底 + 固定白字" },
  "src/app/workforce/studio/studio.css :: .ws-avatar": {
    status: "accepted",
    why: "头像：--agent-color 为按 agent 分配的类别色（未在暗色块内重定义，实测）+ 固定深字",
  },
  "src/app/workforce/studio/studio.css :: .ws .ws-primary": {
    status: "accepted",
    why: "主按钮：--ws-accent 未在暗色块内重定义（实测）+ 固定深字",
  },
  "src/app/workforce/studio/studio.css :: .ws-dialog": {
    status: "accepted",
    why: "模态框：固定深底 #171c18 + --ws-text 令牌字；此面板整体为固定深色容器（深色恒深），非主题跟随面板",
  },
};

test("G3：.css 同一规则内背景与文字必须同源（新债拦截 + 存量登记）", () => {
  // 扫描面自身要有下限，否则路径写错会「零命中即绿」。
  assert.ok(files.length >= 30, `扫描到的 .css 文件数异常偏少（实际 ${files.length}）：路径或过滤条件可能写错`);
  assert.ok(pairs.length > 0, "未扫到任何「背景与文字不同源」的配对：判据或扫描面可能已失效，请先复核守卫本身");

  const unregistered = pairs.filter((pair) => !(pair.key in REGISTERED));
  assert.deepEqual(
    unregistered.map((pair) => `${pair.key}（底 ${pair.background} / 字 ${pair.foreground}，令牌 ${pair.tokens.join(",")}）`),
    [],
    [
      "同一规则内背景与文字不同源（一个走令牌、一个写死）——暗色模式下必然有一态不可读：",
      ...unregistered.map((p) => `  ${p.key}`),
      "",
      "修法：把配对补齐（两边都走令牌，或两边都写死并说明），然后从 REGISTERED 里删掉对应条目；",
      "若确属有意写法，请在 REGISTERED 里登记并写明「为什么明暗两态都成立」。",
    ].join("\n"),
  );

  const malformed = Object.entries(REGISTERED).filter(([, entry]) => !entry.why || entry.why.trim().length < 8);
  assert.deepEqual(
    malformed.map(([key]) => key),
    [],
    "登记表每条都必须写明理由（why 不得为空或敷衍）",
  );

  const stale = Object.keys(REGISTERED).filter((key) => !pairs.some((pair) => pair.key === key));
  const suspect = pairs.filter((pair) => REGISTERED[pair.key]?.status === "suspect");
  console.log(
    [
      `  ℹ G3 扫描 ${files.length} 个 .css 文件，命中「背景/文字不同源」${pairs.length} 处（全部已登记）：`,
      `      待修（令牌做底 + 固定字 / 半透明白底）：${suspect.length} 处`,
      `      结构稳定（语义实色底 + 固定反白）：${pairs.length - suspect.length} 处（未逐条实测对比度）`,
      `      已知未覆盖面：跨规则的配对（父元素负责底、子元素负责字），由对比度审计报告人工覆盖`,
      stale.length ? `      ⚠ 登记表中 ${stale.length} 条已不再命中，请删除以免登记表失真：${stale.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  for (const pair of suspect) console.log(`      · [待修] ${pair.key}`);
});
