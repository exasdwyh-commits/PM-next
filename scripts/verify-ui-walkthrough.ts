/**
 * 全流程可视化走查 + 小屏验收钩子（机器筛 → 红基线）
 *
 * 这是**诊断 / 度量脚本**：绝大部分只报告事实与实测值，不判定通过与否（判定交给 QA / 主理人）。
 * 例外（2026-09-18 起）：G3（无来源评分/百分比，含整数·并集口径）/ G5（弹窗态 R1/R2）/
 *   G6（分母为 0 + 豁免表元校验 H1）
 *   几条会做判定，命中即 exit≠0 —— 其中 G5 是「弹窗关闭按钮 17×17」D1 缺陷的回归锁。
 *   判定结果写入 report.md §7（分母/弹窗态实测）与 §8（判定）。
 *
 * 两个入口：
 *   快路径（1440 / 390，含交互步骤 + 全截图）：默认
 *     NODE_OPTIONS= ./node_modules/.bin/tsx scripts/verify-ui-walkthrough.ts
 *   全矩阵（1440/390 + 6 个小屏电脑档，18 route-entry，仅红屏截图）：
 *     NODE_OPTIONS= ./node_modules/.bin/tsx scripts/verify-ui-walkthrough.ts --full
 *     （或 WALK_FULL=1）
 *   或统一走带并发守卫的包装：bash scripts/ui-walk.sh [--full]
 *
 * 环境变量：WALK_BASE / WALK_EMAIL / WALK_PASSWORD / WALK_OUT /
 *           WALK_STEP_WAIT / WALK_SHOTS(all|red|none) / WALK_CLICK_MIN
 *
 * 采集信号（每屏）：
 *   - scrollWidth / clientWidth / innerWidth（**实测值，不只给布尔**）与 overflow
 *   - overflowOffenders：溢出到视口右缘之外的元素（选择器 + right/width + scrollWidth/clientWidth）
 *   - columns：.project-row / .project-table-head 每个 nth-child 的 display 与实测宽
 *   - clickViolations：< WALK_CLICK_MIN（默认 24）的可点击元素（排 display:none / visibility:hidden /
 *     pointer-events:none / [hidden]），含选择器 + 文本 + w×h
 *   - consoleError / pageError / requestFailed / 泄漏(undefined|NaN|[object Object]) / 英文枚举 / 断图
 *   - unsourcedScoreSamples：可见文本里「无来源评分/百分比」（G3 并集口径：关键词锚定 `(评分|得分|分数|打分)…数字` ∪ 裸小数 `\d+\.\d+\s*(分|%)`）
 *   - counts：分母（被检可点元素数 / 文本块数 / 图片数），供 G6「分母为 0 即失败」核对
 *
 * 产出（写入 WALK_OUT，默认 /tmp/hermes-ui-walk）：
 *   report.md（全量）、red-baseline.md（红基线清单）、manifest.json（原始）、screens/*.png
 */
import { chromium, type Page, type BrowserContext } from "playwright";
import path from "path";
import fs from "fs";

const BASE = process.env.WALK_BASE || "http://localhost:3100";
const EMAIL = process.env.WALK_EMAIL || "li_vp@hermes.test";
const PASSWORD = process.env.WALK_PASSWORD || "admin123";
const OUT = process.env.WALK_OUT || "/tmp/hermes-ui-walk";
const SHOTS = path.join(OUT, "screens");
const NAV_TIMEOUT = 60000;
const CLICK_MIN = Number(process.env.WALK_CLICK_MIN || 24);

// ---------------------------------------------------------------------------
// G3 / G6 断言登记表（本脚本在「只报告」之上，对这两条做判定 → 失败即 exit≠0）
// ---------------------------------------------------------------------------
/**
 * G3 · 无来源「评分 / 百分比」（并集口径；2026-09-18 收紧到整数）。
 *   规则 = 关键词锚定 `(评分|得分|分数|打分)[:：]?<num>(分|%)?`  ∪  裸小数+单位 `\d+\.\d+\s*(分|%)`。
 *   真实有来源的数值要么是整数、要么是「0/N 已核实」比率；关键词锚定的评分形态在真实页面
 *   可见文案里不存在（命中都在注释 / data-label 伪元素里）。
 *   登记制：**实际命中集合必须 === 本清单**（每条附理由）。空数组 = 一个都不允许。
 *   若确有合法命中 → 不要放宽规则，把命中加进这里并写理由（由主理人裁定）。
 */
const UNSOURCED_SCORE_WHITELIST: { token: string; reason: string }[] = [];

/**
 * G6 · 「分母为 0」即视为该检查空跑（历史假绿根因），一律失败。
 *   本表登记**允许空跑**的分母及理由（唯一豁免：断图检查——src 全仓无 <img>）。
 */
const VACUOUS_DENOM_ALLOWED: Record<string, string> = {
  images: "src 全仓无 <img>（2026-09-18 核实）；断图检查天然空跑，非假绿",
};

/**
 * H1 · G6 豁免表的**元校验**：登记的键集合必须与本文件的字面量清单**完全相等**。
 *   这条堵的是「把真实分母悄悄塞进 VACUOUS_DENOM_ALLOWED 放宽检查」这个新假绿入口：
 *   任何扩大豁免表的行为，都必须**同步改动下面这个字面量清单**，从而在代码里留下可见痕迹。
 *   ⚠️ 局限（诚实声明，勿当密码学封锁）：清单与断言在同一文件，改两处即可绕过。
 *      它的作用是「让绕过必须留下可见 diff」，不是无法绕过的强约束。
 */
const VACUOUS_DENOM_REGISTERED = ["images"];

const FULL = process.argv.includes("--full") || process.env.WALK_FULL === "1";
const STEP_WAIT = Number(process.env.WALK_STEP_WAIT || (FULL ? 900 : 1400));
// WALK_SHOTS: all | red | none ；默认：快路径 all（人工看图），全矩阵 red（只留红屏证据）
const SHOTS_MODE = (process.env.WALK_SHOTS || (FULL ? "red" : "all")) as "all" | "red" | "none";

type Tier = { name: string; w: number; h: number };
const ALL_TIERS: Tier[] = [
  { name: "1440", w: 1440, h: 900 },
  { name: "1366", w: 1366, h: 768 },
  { name: "1280", w: 1280, h: 800 },
  { name: "1180", w: 1180, h: 720 },
  { name: "1093", w: 1093, h: 768 }, // 125% 系统缩放等效
  { name: "1024", w: 1024, h: 768 },
  { name: "853", w: 853, h: 700 }, // 150% 缩放等效
  { name: "390", w: 390, h: 844 },
];
const tierByName = (n: string) => ALL_TIERS.find((t) => t.name === n)!;

type Offender = { sel: string; right: number; width: number; scrollWidth: number; clientWidth: number };
type ColumnCell = { nth: number; tag: string; display: string; width: number; text: string };
type ColumnScan = { selector: string; gridTemplateColumns: string; cells: ColumnCell[] } | null;
type ClickViolation = { sel: string; label: string; w: number; h: number };

type Probe = {
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
  overflow: number;
  offenders: Offender[];
  columns: { projectRow: ColumnScan; projectHead: ColumnScan };
  clickViolations: ClickViolation[];
  leakSamples: string[];
  rawEnumSamples: string[];
  unsourcedScoreSamples: string[];
  brokenImages: string[];
  counts: { clickables: number; textLeaves: number; images: number };
};

type Finding = {
  mode: "walk" | "matrix";
  tier: string;
  url: string;
  step: string;
  httpStatus: number | null;
  redirected: boolean;
  title: string;
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
  overflow: number;
  offenders: Offender[];
  columns: { projectRow: ColumnScan; projectHead: ColumnScan };
  clickViolations: ClickViolation[];
  leakSamples: string[];
  rawEnumSamples: string[];
  unsourcedScoreSamples: string[];
  brokenImages: string[];
  counts: { clickables: number; textLeaves: number; images: number };
  note: string;
  shot: string | null;
};

const findings: Finding[] = [];
let stepIndex = 0;

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function emptyProbe(): Probe {
  return {
    scrollWidth: 0,
    clientWidth: 0,
    innerWidth: 0,
    overflow: 0,
    offenders: [],
    columns: { projectRow: null, projectHead: null },
    clickViolations: [],
    leakSamples: [],
    rawEnumSamples: [],
    unsourcedScoreSamples: [],
    brokenImages: [],
    counts: { clickables: 0, textLeaves: 0, images: 0 },
  };
}

/** 绑定采集器：返回一个"结算当前屏"的函数 */
function attachCollectors(page: Page) {
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];
  let requestFailures: string[] = [];

  const onConsole = (m: any) => {
    if (m.type() !== "error") return;
    const t = String(m.text());
    if (/Download the React DevTools|\[Fast Refresh\]|webpack-hmr/i.test(t)) return;
    consoleErrors.push(t.slice(0, 240));
  };
  const onPageError = (e: Error) => pageErrors.push(String(e).slice(0, 240));
  const onReqFailed = (r: any) => {
    const url = r.url();
    const why = r.failure()?.errorText || "";
    if (/favicon|__nextjs_|_next\/static\/chunks\/.*hot-update/.test(url)) return;
    requestFailures.push(`${r.method()} ${url.replace(BASE, "")} — ${why}`);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onReqFailed);

  return {
    reset() {
      consoleErrors = [];
      pageErrors = [];
      requestFailures = [];
    },
    drain() {
      return {
        consoleErrors: [...new Set(consoleErrors)].slice(0, 6),
        pageErrors: [...new Set(pageErrors)].slice(0, 6),
        requestFailures: [...new Set(requestFailures)].slice(0, 6),
      };
    },
  };
}

/**
 * 浏览器内页探针：以**字符串**注入页面执行。
 *
 * ⚠️ 不能把探针写成 .ts 里的函数字面量再 page.evaluate(fn)：tsx(esbuild, keepNames) 会给
 *   具名函数字面量注入 `__name(...)`，Playwright 在页面里执行 fn.toString() 的结果时 __name
 *   未定义 → ReferenceError → 探针被 try/catch 静默回落成默认值（历史假绿根因）。故探针独立
 *   放 scripts/inpage-probe.js（纯 JS，不被转译），在此读成字符串后以自调用表达式 evaluate。
 */
function resolveProbeFile(): string {
  const cands: string[] = [path.resolve(process.cwd(), "scripts", "inpage-probe.js")];
  if (process.argv[1]) cands.push(path.join(path.dirname(path.resolve(process.argv[1])), "inpage-probe.js"));
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error("找不到 scripts/inpage-probe.js（浏览器内页探针），无法采集");
}
const PROBE_SRC = fs.readFileSync(resolveProbeFile(), "utf8");
// 防御：若探针被注入 __name 包装，说明它被转译了 —— 注入页面必然 ReferenceError，宁可直接失败。
// 先去注释再判定，避免文件头注释里提到的 __name 字样误报。
const PROBE_CODE = PROBE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
if (/__name\s*\(/.test(PROBE_CODE)) {
  throw new Error("inpage-probe.js 被注入了 __name（遭转译）；Playwright 注入会在页面里 ReferenceError");
}
const buildProbeExpr = (clickMin: number): string => `(${PROBE_SRC})(${JSON.stringify({ clickMin })})`;

/**
 * 走一屏：导航 → 等稳定 → 采集 → （按策略）截图
 */
async function visit(
  page: Page,
  mode: "walk" | "matrix",
  tier: string,
  collectors: ReturnType<typeof attachCollectors>,
  name: string,
  url: string,
  opts: { actions?: (p: Page) => Promise<string>; note?: string; shot?: "all" | "red" | "none" } = {},
) {
  stepIndex += 1;
  collectors.reset();
  let httpStatus: number | null = null;
  let note = opts.note || "";

  try {
    const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    httpStatus = resp ? resp.status() : null;
    await page.waitForTimeout(STEP_WAIT);
  } catch (err: any) {
    note = `导航失败: ${String(err.message).slice(0, 160)}`;
  }

  if (opts.actions) {
    try {
      const extra = await opts.actions(page);
      if (extra) note = `${note} ${extra}`.trim();
      await page.waitForTimeout(500);
    } catch (err: any) {
      note = `${note} | 动作异常: ${String(err.message).slice(0, 160)}`.trim();
    }
  }

  let probe: Probe = emptyProbe();
  try {
    probe = (await page.evaluate(buildProbeExpr(CLICK_MIN))) as unknown as Probe;
  } catch {
    /* 页面可能已崩，忽略探针失败 */
  }

  const c = collectors.drain();
  const red =
    probe.overflow > 1 ||
    probe.clickViolations.length > 0 ||
    c.consoleErrors.length > 0 ||
    c.pageErrors.length > 0 ||
    probe.leakSamples.length > 0 ||
    probe.unsourcedScoreSamples.length > 0 ||
    probe.brokenImages.length > 0;

  const policy = opts.shot || SHOTS_MODE;
  const wantShot = policy === "all" || (policy === "red" && red);
  const idx = String(stepIndex).padStart(3, "0");
  const shotRel = wantShot ? `${idx}-${tier}-${name}-${mode}.png` : null;
  if (shotRel) {
    try {
      await page.screenshot({ path: path.join(SHOTS, shotRel), fullPage: true });
    } catch {
      /* 忽略截图失败 */
    }
  }

  let title = "";
  try {
    title = (await page.title()).slice(0, 120);
  } catch {
    /* ignore */
  }

  const finalUrl = page.url().replace(BASE, "");
  findings.push({
    mode,
    tier,
    url: finalUrl,
    step: name,
    httpStatus,
    redirected: finalUrl !== url,
    title,
    ...c,
    ...probe,
    note,
    shot: shotRel,
  });

  const flags = [
    probe.overflow > 1 ? `溢出${probe.overflow}px` : "",
    probe.clickViolations.length ? `小目标×${probe.clickViolations.length}` : "",
    c.consoleErrors.length ? `console×${c.consoleErrors.length}` : "",
    c.pageErrors.length ? `pageError×${c.pageErrors.length}` : "",
    c.requestFailures.length ? `reqFail×${c.requestFailures.length}` : "",
    probe.leakSamples.length ? `泄漏×${probe.leakSamples.length}` : "",
    probe.rawEnumSamples.length ? `枚举×${probe.rawEnumSamples.length}` : "",
    probe.unsourcedScoreSamples.length ? `评分×${probe.unsourcedScoreSamples.length}` : "",
    probe.brokenImages.length ? `断图×${probe.brokenImages.length}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `  [${idx}] ${tier.padEnd(5)} ${mode.padEnd(6)} ${url.padEnd(30)} ${httpStatus ?? "---"} ${flags}${
      note ? " · " + note : ""
    }`,
  );
  return page;
}

/**
 * G5 · 弹窗态采集：点开 1 个含触发按钮的弹窗（默认 /products 的「新产品入库」），
 * 在**弹窗打开状态**下跑一遍探针 —— 这样 R1 横向溢出与 R2 点击区都能量到弹窗内部元素
 * （包括曾经漏测的 `.modal-close`）。找不到触发按钮时**记录原因**，不静默跳过。
 */
async function visitModalState(
  page: Page,
  mode: "walk" | "matrix",
  tier: string,
  collectors: ReturnType<typeof attachCollectors>,
  url = "/products",
) {
  const triggers = [
    'button:has-text("新产品入库")',
    'button:has-text("新建产品")',
    'button:has-text("录入")',
    'button:has-text("新建")',
  ];
  return visit(page, mode, tier, collectors, "products-modal", url, {
    actions: async (p) => {
      for (const sel of triggers) {
        const b = p.locator(sel).first();
        if (!(await b.isVisible().catch(() => false))) continue;
        await b.click({ timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(900);
        const open = await p.locator(".hermes-modal-backdrop, .hermes-modal").first().isVisible().catch(() => false);
        if (open) return `弹窗态已打开（${sel}）`;
      }
      return "SKIP: 本档未找到可打开弹窗的触发按钮（弹窗态未采集）";
    },
    note: "弹窗态（R1/R2 在弹窗打开下重测）",
  });
}

/** 关掉可能挡住视线的引导弹窗 / 遮罩 */
async function dismissOnboarding(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const candidates = ["跳过", "下一步", "完成", "我知道了", "知道了", "关闭"];
    let clicked = false;
    for (const label of candidates) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
  }
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissOnboarding(page);
}

async function discoverIds(ctx: BrowserContext, page: Page) {
  const ids = { product: "", project: "" };
  try {
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(2500);
    const href =
      (await page.locator('a[href^="/products/"]').first().getAttribute("href").catch(() => null)) ||
      (await page.locator(".hermes-board-card").first().getAttribute("href").catch(() => null));
    if (href) ids.product = href;
  } catch {
    /* ignore */
  }
  if (!ids.product) {
    try {
      const r = await ctx.request.get(`${BASE}/api/products`);
      if (r.ok()) {
        const j: any = await r.json();
        const first = (j.items || j.products || (Array.isArray(j) ? j : []))[0];
        if (first?.id) ids.product = `/products/${first.id}`;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(1500);
    const href = await page.locator('a[href^="/projects/"]').first().getAttribute("href").catch(() => null);
    if (href) ids.project = href;
  } catch {
    /* ignore */
  }
  if (!ids.project) {
    try {
      const r = await ctx.request.get(`${BASE}/api/projects`);
      if (r.ok()) {
        const j: any = await r.json();
        const first = (j.items || j.projects || (Array.isArray(j) ? j : []))[0];
        if (first?.id) ids.project = `/projects/${first.id}`;
      }
    } catch {
      /* ignore */
    }
  }
  return ids;
}

type Entry = { name: string; url: string };
/** 18 route-entry（12 顶层路由 + 产品详情 6 页签），随 id 可用性伸缩 */
function routeEntries(ids: { product: string; project: string }): Entry[] {
  const p = ids.product;
  const list: Entry[] = [
    { name: "home", url: "/" },
    { name: "products", url: "/products" },
  ];
  if (p) {
    list.push(
      { name: "product-overview", url: p },
      { name: "product-tab-analysis", url: `${p}?tab=analysis` },
      { name: "product-tab-version", url: `${p}?tab=version` },
      { name: "product-tab-cost", url: `${p}?tab=cost` },
      { name: "product-tab-validation", url: `${p}?tab=validation` },
      { name: "product-tab-launch", url: `${p}?tab=launch` },
    );
  }
  if (ids.project) list.push({ name: "project-detail", url: ids.project });
  list.push(
    { name: "advisor", url: "/advisor" },
    { name: "opportunities", url: "/opportunities" },
    { name: "knowledge", url: "/knowledge" },
    { name: "trace", url: "/trace" },
    { name: "war-room", url: "/war-room" },
    { name: "consultation", url: "/consultation" },
    { name: "dashboard", url: "/dashboard" },
    { name: "organization", url: "/organization" },
    { name: "settings", url: "/settings" },
  );
  return list;
}

/** 全矩阵：单档 × 18 route-entry（无交互步骤，纯度量） */
async function runMatrixTier(browser: any, tier: Tier, ids: { product: string; project: string }) {
  const ctx = await browser.newContext({ viewport: { width: tier.w, height: tier.h }, deviceScaleFactor: 1, locale: "zh-CN" });
  const page = await ctx.newPage();
  const collectors = attachCollectors(page);
  console.log(`\n================ [matrix] ${tier.name} (${tier.w}x${tier.h}) ================`);
  await login(page);
  for (const e of routeEntries(ids)) {
    await visit(page, "matrix", tier.name, collectors, e.name, e.url);
  }
  // G5：全矩阵也要进一次弹窗态（历史上 144 屏从不开弹窗 → 漏测 .modal-close 17×17）
  await visitModalState(page, "matrix", tier.name, collectors);
  await ctx.close();
}

/**
 * 快路径：单档的完整可视化走查（含交互步骤）。legacy 语义保留。
 */
async function runLegacyViewport(browser: any, tier: Tier, ids: { product: string; project: string }, opts: { full: boolean }) {
  const ctx = await browser.newContext({ viewport: { width: tier.w, height: tier.h }, deviceScaleFactor: 1, locale: "zh-CN" });
  const page = await ctx.newPage();
  const collectors = attachCollectors(page);
  const tierName = tier.name;
  console.log(`\n================ [walk] ${tierName} (${tier.w}x${tier.h}) ================`);

  await visit(page, "walk", tierName, collectors, "login", "/login", { note: "未登录态首屏" });
  await visit(page, "walk", tierName, collectors, "login-error", "/login", {
    actions: async (p) => {
      await p.fill('input[type="email"]', EMAIL);
      await p.fill('input[type="password"]', "wrong-password-000");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(2200);
      const msg = await p
        .locator('[role=alert], .hermes-toast, .hermes-error, [class*=error]')
        .first()
        .innerText()
        .catch(() => "");
      return `错误提示="${String(msg).replace(/\s+/g, " ").slice(0, 80)}"`;
    },
  });

  await login(page);
  const desktopOnly = tierName === "1440";

  await visit(page, "walk", tierName, collectors, "home", "/", { note: "首页分层简报" });
  await visit(page, "walk", tierName, collectors, "products", "/products", {
    actions: async (p) => `行数=${await p.locator(".project-row, .hermes-board-card").count()}`,
  });
  await visit(page, "walk", tierName, collectors, "products-board", "/products", {
    actions: async (p) => {
      const b = p.locator('button:has-text("阶段看板")').first();
      if (await b.isVisible().catch(() => false)) {
        await b.click();
        await p.waitForTimeout(900);
      }
      return `看板列=${await p.locator(".hermes-board-col").count()}`;
    },
  });

  // G5：弹窗态重测 R1/R2（快路径各档都跑，含 390 —— 弹窗 width:min(560px,92vw) 需在小屏有兜底）
  await visitModalState(page, "walk", tierName, collectors);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  if (desktopOnly) {
    await visit(page, "walk", tierName, collectors, "products-ingest-modal", "/products", {
      actions: async (p) => {
        const b = p.locator('button:has-text("新产品入库")').first();
        if (!(await b.isVisible().catch(() => false))) return "无入库按钮";
        await b.click();
        await p.waitForTimeout(1000);
        const open = await p.locator(".hermes-modal").first().isVisible().catch(() => false);
        return open ? "弹窗已打开（未提交，避免污染数据）" : "点击后弹窗未出现";
      },
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  if (ids.product) {
    await visit(page, "walk", tierName, collectors, "product-overview", ids.product);
    const tabs = ["分析与评分", "方案与版本", "成本与供应", "验证与风险", "上市计划"];
    for (const tab of tabs) {
      const slug = tab.replace(/\//g, "");
      await visit(page, "walk", tierName, collectors, `product-tab-${slug}`, ids.product, {
        actions: async (p) => {
          const b = p.locator(`button:has-text("${tab}")`).first();
          if (!(await b.isVisible().catch(() => false))) return `未找到页签「${tab}」`;
          await b.click();
          await p.waitForTimeout(1400);
          return `已切到「${tab}」 url=${p.url().replace(BASE, "")}`;
        },
      });
    }
    if (desktopOnly) {
      await visit(page, "walk", tierName, collectors, "product-reason-dialog", ids.product, {
        actions: async (p) => {
          const b = p.locator('button:has-text("上市计划")').first();
          if (await b.isVisible().catch(() => false)) {
            await b.click();
            await p.waitForTimeout(1200);
          }
          const triggers = [
            'button:has-text("提交放行")',
            'button:has-text("申请放行")',
            'button:has-text("提交审批")',
            'button:has-text("审批")',
            'button:has-text("驳回")',
            'button:has-text("退回")',
          ];
          for (const sel of triggers) {
            const t = p.locator(sel).first();
            if (await t.isVisible().catch(() => false)) {
              await t.click({ timeout: 3000 }).catch(() => {});
              await p.waitForTimeout(900);
              const dlg = p.locator('[role=dialog], .hermes-dialog, .hermes-modal').first();
              if (await dlg.isVisible().catch(() => false)) return `对话框已打开（${sel}）`;
            }
          }
          return "未找到触发理由对话框的按钮（人工看图确认）";
        },
      });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  } else {
    console.log("  !! 未发现任何产品 id，跳过产品详情走查");
  }

  if (ids.project) {
    await visit(page, "walk", tierName, collectors, "project-detail", ids.project, {
      actions: async (p) => `页签数=${await p.locator(".hermes-tabs button, [role=tab]").count()}`,
    });
  } else {
    console.log("  !! 未发现任何项目 id，跳过项目详情走查");
  }

  await visit(page, "walk", tierName, collectors, "advisor", "/advisor", {
    actions: async (p) => `输入框=${await p.locator("textarea").count()}`,
  });

  if (desktopOnly) {
    await visit(
      page,
      "walk",
      tierName,
      collectors,
      "advisor-thinking",
      ids.product ? `/advisor?product=${ids.product.replace("/products/", "")}` : "/advisor",
      {
        actions: async (p) => {
          const ta = p.locator("textarea").first();
          if (!(await ta.isVisible().catch(() => false))) return "无输入框";
          await ta.fill("请评估当前产品的上市准备度与核心风险，只回一句。");
          const send = p.locator('button:has-text("发送")').first();
          await send.click({ timeout: 4000 }).catch(() => {});
          await p.waitForTimeout(700);
          const thinking = await p.locator(".hermes-thinking").first().isVisible().catch(() => false);
          await p.waitForTimeout(2500);
          return `思考动画出现=${thinking} 消息气泡数=${await p.locator(".hermes-chat-msg").count()}`;
        },
      },
    );
  }

  await visit(page, "walk", tierName, collectors, "opportunities", "/opportunities");
  await visit(page, "walk", tierName, collectors, "knowledge", "/knowledge", {
    actions: async (p) => `页签数=${await p.locator(".hermes-tabs button, [role=tab]").count()}`,
  });

  if (desktopOnly) {
    await visit(page, "walk", tierName, collectors, "knowledge-sync-modal", "/knowledge", {
      actions: async (p) => {
        const b = p.locator('button:has-text("挂载与同步管理")').first();
        if (!(await b.isVisible().catch(() => false))) return "无同步按钮";
        await b.click();
        await p.waitForTimeout(1000);
        const open = await p.locator(".hermes-modal, [role=dialog]").first().isVisible().catch(() => false);
        return open ? "弹窗已打开" : "点击后未出现弹窗";
      },
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  await visit(page, "walk", tierName, collectors, "trace", "/trace");
  await visit(page, "walk", tierName, collectors, "war-room", "/war-room");
  await visit(page, "walk", tierName, collectors, "consultation", "/consultation");
  await visit(page, "walk", tierName, collectors, "dashboard", "/dashboard");
  await visit(page, "walk", tierName, collectors, "organization", "/organization");
  await visit(page, "walk", tierName, collectors, "settings", "/settings");

  if (opts.full) {
    await visit(page, "walk", tierName, collectors, "not-found", "/this-route-does-not-exist-9f3a", {
      note: "应渲染 404 页（HTTP 状态另见 httpStatus）",
    });
    const anonCtx = await browser.newContext({ viewport: { width: tier.w, height: tier.h } });
    const anon = await anonCtx.newPage();
    attachCollectors(anon);
    await visit(anon, "walk", tierName, collectors, "anon-guard-products", "/products", {
      note: "未登录访问受保护页（应跳 /login）",
    });
    await anonCtx.close();
    await visit(page, "walk", tierName, collectors, "logout", "/", {
      actions: async (p) => {
        const b = p.locator('button:has-text("退出"), a:has-text("退出")').first();
        if (!(await b.isVisible().catch(() => false))) return "页面上未直接暴露退出入口";
        await b.click();
        await p.waitForTimeout(2200);
        return `退出后 url=${p.url().replace(BASE, "")}`;
      },
    });
  }

  await ctx.close();
}

// ===========================================================================
// 报告
// ===========================================================================
function isRed(f: Finding): boolean {
  return (
    f.overflow > 1 ||
    f.clickViolations.length > 0 ||
    f.consoleErrors.length > 0 ||
    f.pageErrors.length > 0 ||
    f.requestFailures.length > 0 ||
    f.leakSamples.length > 0 ||
    f.rawEnumSamples.length > 0 ||
    f.unsourcedScoreSamples.length > 0 ||
    f.brokenImages.length > 0 ||
    (f.httpStatus !== null && f.httpStatus >= 500)
  );
}

const esc = (s: string) => s.replace(/\|/g, "/");

/** 分母汇总（G6）：Σ 全屏的被检元素数 / 文本块数 / 图片数 */
function denomTotals() {
  const t = { clickables: 0, textLeaves: 0, images: 0 };
  for (const f of findings) {
    t.clickables += f.counts?.clickables || 0;
    t.textLeaves += f.counts?.textLeaves || 0;
    t.images += f.counts?.images || 0;
  }
  return t;
}

/**
 * G3 / G5 / G6 判定：返回问题清单（空 = 通过）。
 *   - G6：分母为 0 即「该检查空跑（假绿）」→ 失败（登记豁免除外）。
 *   - G6 元校验（H1）：豁免表键集合必须 === 字面量登记集合，且每条理由非空。
 *   - G5：弹窗态 R1/R2 必须为 0（D1 回归锁）；弹窗未打开 → 失败（记录原因）。
 *   - G3：无来源评分/百分比命中集合必须 === 登记清单。
 */
function evaluateGuards(): string[] {
  const problems: string[] = [];
  const denom = denomTotals();
  for (const [k, v] of Object.entries(denom)) {
    if (v <= 0 && !(k in VACUOUS_DENOM_ALLOWED)) problems.push(`G6 分母为 0：${k}（该检查空跑，疑似假绿）`);
  }
  // H1 · G6 豁免表元校验：堵「悄悄扩大豁免表」这一假绿入口（无此条时，把任一真实分母塞进表即可静默放宽）。
  const allowedKeys = Object.keys(VACUOUS_DENOM_ALLOWED).sort();
  const registeredKeys = [...VACUOUS_DENOM_REGISTERED].sort();
  if (allowedKeys.join(",") !== registeredKeys.join(","))
    problems.push(
      `G6 豁免表与登记集合不一致：豁免=[${allowedKeys.join(",") || "无"}] vs 登记=[${registeredKeys.join(",") || "无"}]（扩大豁免表必须同步登记字面量清单）`,
    );
  for (const [k, reason] of Object.entries(VACUOUS_DENOM_ALLOWED))
    if (!reason || !reason.trim()) problems.push(`G6 豁免项 ${k} 的理由为空（每条例外必须写明理由）`);
  const modal = findings.filter((f) => f.step === "products-modal");
  const opened = modal.filter((f) => f.note.includes("弹窗态已打开"));
  if (modal.length > 0 && opened.length === 0) problems.push("G5 弹窗态全程未成功打开（检查未生效，见各档备注）");
  for (const f of opened) {
    if (f.clickViolations.length > 0)
      problems.push(`G5 弹窗态点击区违规 @${f.tier}：${f.clickViolations.map((v) => `${v.sel} ${v.w}×${v.h}`).join("；")}`);
    if (f.overflow > 1) problems.push(`G5 弹窗态横向溢出 @${f.tier}：${f.overflow}px`);
  }
  const actual = [...new Set(findings.flatMap((f) => f.unsourcedScoreSamples || []))].sort();
  const registered = UNSOURCED_SCORE_WHITELIST.map((w) => w.token).sort();
  const extra = actual.filter((t) => !registered.includes(t));
  const missing = registered.filter((t) => !actual.includes(t));
  if (extra.length) problems.push(`G3 命中未登记的评分/百分比：${extra.join(", ")}`);
  if (missing.length) problems.push(`G3 登记了但未命中：${missing.join(", ")}`);
  return problems;
}

function writeReports(secs: string): string[] {
  const red = findings.filter(isRed);
  const tiers = [...new Set(findings.map((f) => f.tier))];

  // ---------- report.md ----------
  const L: string[] = [];
  L.push(`# 全流程可视化走查 + 小屏验收度量报告`);
  L.push(``);
  L.push(`- 目标: ${BASE}`);
  L.push(`- 模式: **${FULL ? "全矩阵（8 档）" : "快路径（1440/390）"}**  截图策略=${SHOTS_MODE}  点击区阈值=${CLICK_MIN}×${CLICK_MIN}`);
  L.push(`- 档位: ${tiers.join(", ")}`);
  L.push(`- 屏幕数: ${findings.length}（有信号 ${red.length}）`);
  L.push(`- 耗时: ${secs}s`);
  L.push(`- 生成时间: ${new Date().toISOString()}`);
  L.push(``);

  // 1) 横向溢出矩阵
  L.push(`## 1. 横向溢出矩阵（documentElement.scrollWidth − clientWidth，单位 px；0 = 未溢出）`);
  L.push(``);
  const matrixFindings = findings.filter((f) => f.mode === "matrix");
  if (matrixFindings.length === 0) {
    L.push(`> 快路径不含全矩阵度量（用 \`--full\` 生成）。`);
  } else {
    const routeNames = [...new Set(matrixFindings.map((f) => f.step))];
    L.push(`| route \\ 档 | ${tiers.join(" | ")} |`);
    L.push(`|---|${tiers.map(() => "---").join("|")}|`);
    for (const r of routeNames) {
      const cells = tiers.map((t) => {
        const f = matrixFindings.find((x) => x.step === r && x.tier === t);
        if (!f) return "-";
        return f.overflow > 1 ? `**${f.overflow}**` : "0";
      });
      L.push(`| ${r} | ${cells.join(" | ")} |`);
    }
    L.push(``);
    L.push(`### 1b. scrollWidth / clientWidth 实测值（仅列溢出档）`);
    L.push(``);
    const ovr = matrixFindings.filter((f) => f.overflow > 1);
    if (ovr.length === 0) {
      L.push(`全矩阵 **无横向溢出**。`);
    } else {
      L.push(`| 档 | route | scrollWidth | clientWidth | 溢出 | 溢出元素（selector @ right | scrollW/clientW） |`);
      L.push(`|---|---|---|---|---|---|`);
      for (const f of ovr) {
        const off = f.offenders.map((o) => `\`${o.sel}\` @${o.right} | ${o.scrollWidth}/${o.clientWidth}`).join("； ");
        L.push(`| ${f.tier} | ${f.step} | ${f.scrollWidth} | ${f.clientWidth} | **${f.overflow}** | ${esc(off)} |`);
      }
    }
    L.push(``);
  }

  // 2) 列可见性
  L.push(`## 2. \`.project-row\` / \`.project-table-head\` 列可见性（nth-child → display / 实测宽 px）`);
  L.push(``);
  L.push(`> ⚠️ **必读列清单待架构师 A 段定稿后替换** —— 本表只登记当前实测可见性，不预设哪列必读。`);
  L.push(``);
  const prodFindings = findings.filter((f) => f.step === "products");
  if (prodFindings.length === 0) {
    L.push(`> 本次未采集到 /products 的 .project-row（可能为空态）。`);
  } else {
    for (const t of tiers) {
      const f = prodFindings.find((x) => x.tier === t);
      if (!f) continue;
      const pr = f.columns.projectRow;
      const ph = f.columns.projectHead;
      L.push(`### 档 ${t}`);
      L.push(`- \`.project-row\` grid-template-columns：\`${pr ? pr.gridTemplateColumns : "(无该元素)"}\``);
      L.push(`- \`.project-table-head\` grid-template-columns：\`${ph ? ph.gridTemplateColumns : "(无该元素)"}\``);
      if (pr) {
        L.push(``);
        L.push(`| nth | tag | display | width | 文本 |`);
        L.push(`|---|---|---|---|---|`);
        for (const c of pr.cells) L.push(`| ${c.nth} | ${c.tag} | ${c.display} | ${c.width} | ${esc(c.text)} |`);
      }
      L.push(``);
    }
  }

  // 3) 点击区违规
  L.push(`## 3. 点击区 < ${CLICK_MIN}×${CLICK_MIN} 违规清单`);
  L.push(``);
  L.push(`（已排除 display:none / visibility:hidden / pointer-events:none / [hidden]；另剔除 rect 宽高为 0 的不可见元素）`);
  L.push(``);
  const clickFindings = findings.filter((f) => f.clickViolations.length > 0);
  if (clickFindings.length === 0) {
    L.push(`无违规。`);
  } else {
    L.push(`| 档 | route | selector | 文本 | w×h |`);
    L.push(`|---|---|---|---|---|`);
    for (const f of clickFindings) {
      for (const v of f.clickViolations) {
        L.push(`| ${f.tier} | ${f.step} | \`${v.sel}\` | ${esc(v.label)} | ${v.w}×${v.h} |`);
      }
    }
  }
  L.push(``);

  // 4) 英文枚举
  const enumAll = new Map<string, string[]>();
  findings.forEach((f) =>
    f.rawEnumSamples.forEach((e) => {
      if (!enumAll.has(e)) enumAll.set(e, []);
      enumAll.get(e)!.push(`${f.tier}:${f.step}`);
    }),
  );
  L.push(`## 4. 英文枚举泄漏分布`);
  L.push(``);
  if (enumAll.size === 0) {
    L.push(`未发现英文枚举泄漏。`);
  } else {
    [...enumAll.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([e, s]) => L.push(`- \`${e}\` × ${s.length}：${[...new Set(s)].slice(0, 8).join(", ")}`));
  }
  L.push(``);

  // 5) 其它信号
  L.push(`## 5. 其它信号（console / pageError / reqFail / 泄漏 / 断图 / HTTP≥500）`);
  L.push(``);
  const otherRed = findings.filter(
    (f) =>
      f.consoleErrors.length ||
      f.pageErrors.length ||
      f.requestFailures.length ||
      f.leakSamples.length ||
      f.unsourcedScoreSamples.length ||
      f.brokenImages.length ||
      (f.httpStatus !== null && f.httpStatus >= 500),
  );
  if (otherRed.length === 0) {
    L.push(`无。`);
  } else {
    for (const f of otherRed) {
      L.push(`### ${f.tier} · ${f.step} \`${f.url}\``);
      if (f.httpStatus && f.httpStatus >= 500) L.push(`- **HTTP ${f.httpStatus}**`);
      if (f.consoleErrors.length) L.push(`- console: ${f.consoleErrors.map((x) => `\`${x}\``).join(" / ")}`);
      if (f.pageErrors.length) L.push(`- pageError: ${f.pageErrors.map((x) => `\`${x}\``).join(" / ")}`);
      if (f.requestFailures.length) L.push(`- reqFail: ${f.requestFailures.map((x) => `\`${x}\``).join(" / ")}`);
      if (f.leakSamples.length) L.push(`- 泄漏: ${f.leakSamples.map((x) => `"${x}"`).join(" / ")}`);
      if (f.unsourcedScoreSamples.length) L.push(`- 无来源评分/百分比: ${f.unsourcedScoreSamples.map((x) => `\`${x}\``).join(" / ")}`);
      if (f.brokenImages.length) L.push(`- 断图: ${f.brokenImages.join(" / ")}`);
      if (f.shot) L.push(`- 截图: \`screens/${f.shot}\``);
      L.push(``);
    }
  }
  L.push(``);
  L.push(`## 6. 逐屏明细`);
  L.push(``);
  L.push(`| # | 档 | 模式 | route | URL | HTTP | scrollW | clientW | 溢出 | 小目标 | console | pageErr | 泄漏 | 枚举 | 断图 | 备注 |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  findings.forEach((f, i) => {
    L.push(
      `| ${i + 1} | ${f.tier} | ${f.mode} | ${f.step} | \`${f.url}\` | ${f.httpStatus ?? "---"} | ${f.scrollWidth} | ${
        f.clientWidth
      } | ${f.overflow > 1 ? `**${f.overflow}**` : "-"} | ${f.clickViolations.length || "-"} | ${
        f.consoleErrors.length || "-"
      } | ${f.pageErrors.length || "-"} | ${f.leakSamples.length || "-"} | ${f.rawEnumSamples.length || "-"} | ${
        f.brokenImages.length || "-"
      } | ${f.note ? esc(f.note) : ""} |`,
    );
  });
  L.push(``);
  // 7) G6 分母核对 + G5 弹窗态
  L.push(`## 7. 分母核对（G6）与弹窗态（G5）`);
  L.push(``);
  const denom = denomTotals();
  L.push(`- 全程被检**可点元素数**（R2 分母，Σ屏）: ${denom.clickables}`);
  L.push(`- 全程被检**文本块数**（R3 分母，Σ屏）: ${denom.textLeaves}`);
  L.push(
    `- 全程被检**图片数**（断图分母，Σ屏）: ${denom.images}` +
      (denom.images === 0 ? `（空跑，已登记豁免：${VACUOUS_DENOM_ALLOWED.images}）` : ""),
  );
  L.push(``);
  const modalFindings = findings.filter((f) => f.step === "products-modal");
  L.push(`### 弹窗态（G5）R1 溢出 / R2 点击区 实测`);
  L.push(``);
  if (modalFindings.length === 0) {
    L.push(`> 本次未采集到弹窗态。`);
  } else {
    L.push(`| 档 | 弹窗 | R1 溢出 px | R2 小目标数 | 备注 |`);
    L.push(`|---|---|---|---|---|`);
    for (const f of modalFindings) {
      const opened = f.note.includes("弹窗态已打开");
      L.push(
        `| ${f.tier} | ${opened ? "已打开" : "未打开"} | ${f.overflow > 1 ? `**${f.overflow}**` : "0"} | ${
          f.clickViolations.length
        } | ${esc(f.note)} |`,
      );
    }
  }
  L.push(``);
  // 8) 判定
  const problems = evaluateGuards();
  L.push(`## 8. 走查判定（G3 / G5 / G6 + H1 豁免表元校验）`);
  L.push(``);
  if (problems.length === 0) L.push(`✅ 全部通过`);
  else problems.forEach((p) => L.push(`- ❌ ${p}`));
  L.push(``);
  fs.writeFileSync(path.join(OUT, "report.md"), L.join("\n"));

  // ---------- red-baseline.md ----------
  const B: string[] = [];
  B.push(`# 小屏红基线（修复前）`);
  B.push(``);
  B.push(`生成时间：${new Date().toISOString()}`);
  B.push(``);
  B.push(`目标：${BASE}　模式：${FULL ? "全矩阵（8 档）" : "快路径（1440/390）"}　耗时：${secs}s`);
  B.push(`档位：${tiers.join(", ")}　route-entry：${[...new Set(findings.map((f) => f.step))].length} 个/档`);
  B.push(``);
  B.push(`> 本文件是**红→绿对照证据**：修复前的事实快照。修复后重跑，红项应消失或收敛。`);
  B.push(``);

  B.push(`## R1. 横向溢出（scrollWidth > clientWidth）`);
  B.push(``);
  const ovrAll = findings.filter((f) => f.overflow > 1);
  if (ovrAll.length === 0) B.push(`✅ 无`);
  else {
    B.push(`| 档 | route | scrollWidth | clientWidth | 溢出 px | 溢出元素（selector @ right | scrollW/clientW） |`);
    B.push(`|---|---|---|---|---|---|`);
    for (const f of ovrAll) {
      const off = f.offenders.map((o) => `\`${o.sel}\` @${o.right} | ${o.scrollWidth}/${o.clientWidth}`).join("； ") || "(未定位到具体元素)";
      B.push(`| ${f.tier} | ${f.step} | ${f.scrollWidth} | ${f.clientWidth} | **${f.overflow}** | ${esc(off)} |`);
    }
  }
  B.push(``);

  B.push(`## R2. 必读列不得 display:none`);
  B.push(``);
  B.push(`> ⚠️ **必读列清单待架构师 A 段定稿后替换**。下表登记各档实测可见性（本仓已知阈值大致在 ≤1100 / ≤800）。`);
  B.push(``);
  const prodAll = findings.filter((f) => f.step === "products");
  const maxNth = Math.max(0, ...prodAll.map((f) => (f.columns.projectRow ? f.columns.projectRow.cells.length : 0)));
  if (maxNth === 0) B.push(`（未采集到 .project-row）`);
  else {
    B.push(`| nth-child \\ 档 | ${tiers.join(" | ")} |`);
    B.push(`|---|${tiers.map(() => "---").join("|")}|`);
    for (let n = 1; n <= maxNth; n += 1) {
      const cells = tiers.map((t) => {
        const f = prodAll.find((x) => x.tier === t);
        const c = f?.columns.projectRow?.cells.find((x) => x.nth === n);
        if (!c) return "-";
        return `${c.display}/${c.width}`;
      });
      B.push(`| #${n} | ${cells.join(" | ")} |`);
    }
    B.push(``);
    B.push(`（单元格式 = display / 实测宽px）`);
  }
  B.push(``);

  B.push(`## R3. 点击区 < ${CLICK_MIN}×${CLICK_MIN}`);
  B.push(``);
  const clickAll = findings.filter((f) => f.clickViolations.length > 0);
  if (clickAll.length === 0) B.push(`✅ 无`);
  else {
    const agg = new Map<string, { tiers: Set<string>; routes: Set<string>; w: number; h: number; label: string }>();
    for (const f of clickAll) {
      for (const v of f.clickViolations) {
        const key = v.sel;
        if (!agg.has(key)) agg.set(key, { tiers: new Set(), routes: new Set(), w: v.w, h: v.h, label: v.label });
        const a = agg.get(key)!;
        a.tiers.add(f.tier);
        a.routes.add(f.step);
      }
    }
    B.push(`| selector | 文本 | w×h | 出现档 | route |`);
    B.push(`|---|---|---|---|---|`);
    [...agg.entries()].sort((a, b) => a[1].h - b[1].h).forEach(([sel, a]) => {
      B.push(`| \`${sel}\` | ${esc(a.label)} | ${a.w}×${a.h} | ${[...a.tiers].join(",")} | ${[...a.routes].join(",")} |`);
    });
  }
  B.push(``);

  B.push(`## R4. 其它（console / pageError / 泄漏 / 枚举 / 断图 / HTTP≥500）`);
  B.push(``);
  const otherAll = findings.filter(
    (f) =>
      f.consoleErrors.length ||
      f.pageErrors.length ||
      f.requestFailures.length ||
      f.leakSamples.length ||
      f.rawEnumSamples.length ||
      f.unsourcedScoreSamples.length ||
      f.brokenImages.length ||
      (f.httpStatus !== null && f.httpStatus >= 500),
  );
  if (otherAll.length === 0) B.push(`✅ 无`);
  else {
    for (const f of otherAll) {
      const bits: string[] = [];
      if (f.httpStatus && f.httpStatus >= 500) bits.push(`HTTP${f.httpStatus}`);
      if (f.consoleErrors.length) bits.push(`console×${f.consoleErrors.length}`);
      if (f.pageErrors.length) bits.push(`pageError×${f.pageErrors.length}`);
      if (f.requestFailures.length) bits.push(`reqFail×${f.requestFailures.length}`);
      if (f.leakSamples.length) bits.push(`泄漏×${f.leakSamples.length}: ${f.leakSamples.slice(0, 3).join(" / ")}`);
      if (f.rawEnumSamples.length) bits.push(`枚举: ${f.rawEnumSamples.join(",")}`);
      if (f.unsourcedScoreSamples.length) bits.push(`无来源评分: ${f.unsourcedScoreSamples.join(", ")}`);
      if (f.brokenImages.length) bits.push(`断图×${f.brokenImages.length}`);
      B.push(`- **${f.tier} · ${f.step}** \`${f.url}\` — ${bits.join("； ")}`);
    }
  }
  B.push(``);
  fs.writeFileSync(path.join(OUT, "red-baseline.md"), B.join("\n"));

  console.log(`\n✅ 走查完成：${findings.length} 屏，有信号 ${red.length} 屏，耗时 ${secs}s`);
  console.log(`   报告 ${path.join(OUT, "report.md")}`);
  console.log(`   红基线 ${path.join(OUT, "red-baseline.md")}`);
  console.log(`   截图 ${SHOTS}`);
  console.log(`   溢出屏 ${findings.filter((f) => f.overflow > 1).length} · 点击区违规屏 ${findings.filter((f) => f.clickViolations.length).length}`);
  return problems;
}

async function main() {
  ensureDir(OUT);
  ensureDir(SHOTS);
  console.log(
    `▶ 走查 @ ${BASE}　模式=${FULL ? "全矩阵(8档)" : "快路径(1440/390)"}　截图=${SHOTS_MODE}　点击阈值=${CLICK_MIN}　输出=${OUT}`,
  );

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });

  const bootCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const bootPage = await bootCtx.newPage();
  await login(bootPage);
  const ids = await discoverIds(bootCtx, bootPage);
  console.log(`▶ 发现: product=${ids.product || "(无)"} project=${ids.project || "(无)"}`);
  await bootCtx.close();
  fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(ids, null, 2));

  const t0 = Date.now();
  if (FULL) {
    for (const tier of ALL_TIERS) await runMatrixTier(browser, tier, ids);
  } else {
    await runLegacyViewport(browser, tierByName("1440"), ids, { full: true });
    await runLegacyViewport(browser, tierByName("390"), ids, { full: false });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  await browser.close();
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(findings, null, 2));
  const problems = writeReports(secs);
  console.log(`\n▶ 走查判定（G3/G5/G6 + H1）`);
  if (problems.length === 0) {
    console.log(`  ✔ G3/G5/G6 + H1 全部通过`);
  } else {
    problems.forEach((p) => console.log(`  ❌ ${p}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("走查脚本崩溃:", e);
  process.exitCode = 1;
});
