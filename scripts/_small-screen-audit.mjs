/**
 * 小屏电脑自适应 · 横向溢出实测（诊断脚本，只报事实不判定）
 *
 * 目的：在真实浏览器里，对 14 个路由（+ 产品 6 页签）在多个「小屏笔记本 / 高缩放」宽度下
 * 实测 document 级横向溢出，并定位**具体溢出元素**。
 *
 * 用法（服务由调用方起，端口 3120 起，避开工程师的 3100/3110/3111）：
 *   AUDIT_BASE=http://127.0.0.1:3120 NODE_OPTIONS= ./node_modules/.bin/tsx scripts/_small-screen-audit.mjs
 * 代理：本机代理会劫持 localhost，故浏览器参数带 --no-proxy-server。
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import os from "os";

const BASE = process.env.AUDIT_BASE || "http://127.0.0.1:3120";
const EMAIL = process.env.AUDIT_EMAIL || "li_vp@hermes.test";
const PASSWORD = process.env.AUDIT_PASSWORD || "admin123";
const OUT = process.env.AUDIT_OUT || "/tmp/hermes-small-screen";

const WIDTHS = [
  { w: 1366, h: 768, tag: "1366@100%" },
  { w: 1280, h: 800, tag: "1280@100%" },
  { w: 1180, h: 720, tag: "1180@100%" },
  { w: 1024, h: 768, tag: "1024@100%" },
  { w: 1093, h: 720, tag: "1093@125%zoom" },
  { w: 853, h: 640, tag: "853@150%zoom" },
];

const ROUTES = [
  { name: "home", url: "/" },
  { name: "products", url: "/products" },
  { name: "opportunities", url: "/opportunities" },
  { name: "advisor", url: "/advisor" },
  { name: "consultation", url: "/consultation" },
  { name: "dashboard", url: "/dashboard" },
  { name: "knowledge", url: "/knowledge" },
  { name: "settings", url: "/settings" },
  { name: "trace", url: "/trace" },
  { name: "war-room", url: "/war-room" },
  { name: "organization", url: "/organization" },
  { name: "login", url: "/login" },
];

function chromePath() {
  const HOME = os.homedir();
  const cands = [
    process.env.CHROME_PATH,
    path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p));
}

/** 在页面里跑：测 doc 溢出 + 定位溢出元素 */
const PROBE = () => {
  const docEl = document.documentElement;
  const body = document.body;
  const vw = docEl.clientWidth;
  const winW = window.innerWidth;

  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 5) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += `#${cur.id}`;
      const cls = (cur.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      if (cls) s += `.${cls}`;
      parts.unshift(s);
      cur = cur.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  };

  const overflowsViewport = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return r.right > vw + 1;
  };

  const offenders = [];
  const all = [...document.querySelectorAll("body *")];
  for (const el of all) {
    if (!overflowsViewport(el)) continue;
    // 只取「最外层」：父元素不溢出的才算根因
    if (el.parentElement && overflowsViewport(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    offenders.push({
      sel: pathOf(el),
      right: Math.round(r.right),
      width: Math.round(r.width),
      display: cs.display,
      overflowX: cs.overflowX,
      grid: cs.gridTemplateColumns,
    });
  }
  offenders.sort((a, b) => b.right - a.right);

  // 自身横向可滚动的容器（可能是设计意图，但仍记录）
  const scrollers = [];
  for (const el of all) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") {
        scrollers.push({ sel: pathOf(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
      }
    }
  }

  // 点击区 < 24px（小屏人性化）
  const tiny = [];
  for (const el of document.querySelectorAll("button, a, [role=button], select, input[type=checkbox]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.width < 24 || r.height < 24) {
      tiny.push({ sel: pathOf(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  return {
    innerWidth: winW,
    docClientWidth: vw,
    docScrollWidth: docEl.scrollWidth,
    bodyScrollWidth: body.scrollWidth,
    overflow: docEl.scrollWidth - vw,
    offenders: offenders.slice(0, 6),
    scrollers: scrollers.slice(0, 6),
    tinyCount: tiny.length,
    tiny: tiny.slice(0, 5),
  };
};

async function dismissOnboarding(page) {
  for (let i = 0; i < 3; i += 1) {
    let clicked = false;
    for (const label of ["跳过", "完成", "我知道了", "知道了", "关闭"]) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
  }
}

async function main() {
  const exe = chromePath();
  if (!exe) {
    console.error("未找到 chromium 可执行文件");
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: "zh-CN" });
  const page = await ctx.newPage();

  // ---- 登录（必须先登录，否则 /api 发现 id 会 401） ----
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await dismissOnboarding(page);

  // ---- 发现 product / project id（登录后，带 cookie） ----
  const ids = { product: "", project: "" };
  try {
    const r = await ctx.request.get(`${BASE}/api/products`);
    if (r.ok()) {
      const j = await r.json();
      const first = (j.items || j.products || (Array.isArray(j) ? j : []))[0];
      if (first?.id) ids.product = `/products/${first.id}`;
    }
  } catch { /* ignore */ }
  try {
    const r = await ctx.request.get(`${BASE}/api/projects`);
    if (r.ok()) {
      const j = await r.json();
      const first = (j.items || j.projects || (Array.isArray(j) ? j : []))[0];
      if (first?.id) ids.project = `/projects/${first.id}`;
    }
  } catch { /* ignore */ }
  // 兜底：从页面链接抓（API 结构不确定时）
  if (!ids.product) {
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const href = await page.locator('a[href^="/products/"]').first().getAttribute("href").catch(() => null);
    if (href) ids.product = href;
  }
  if (!ids.project) {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const href = await page.locator('a[href^="/projects/"]').first().getAttribute("href").catch(() => null);
    if (href) ids.project = href;
  }
  console.log(`  [发现] product=${ids.product || "(无)"} project=${ids.project || "(无)"}`);

  const routes = [...ROUTES];
  if (ids.product) {
    routes.push({ name: "product-overview", url: ids.product });
    for (const t of ["analysis", "version", "cost", "validation", "launch"]) {
      routes.push({ name: `product-${t}`, url: `${ids.product}?tab=${t}` });
    }
  }
  if (ids.project) routes.push({ name: "project-detail", url: ids.project });

  const results = [];
  for (const route of routes) {
    // /login 不能用已登录上下文（会跳走）；单独用新 context 测未登录态
    if (route.url === "/login") {
      const anon = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const ap = await anon.newPage();
      for (const vw of WIDTHS) {
        await ap.setViewportSize({ width: vw.w, height: vw.h });
        await ap.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        await ap.waitForTimeout(600);
        const p = await ap.evaluate(PROBE).catch(() => null);
        if (p) results.push({ route: "login", ...vw, ...p });
      }
      await anon.close();
      continue;
    }
    await page.goto(BASE + route.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await dismissOnboarding(page);
    for (const vw of WIDTHS) {
      await page.setViewportSize({ width: vw.w, height: vw.h });
      await page.waitForTimeout(450);
      const p = await page.evaluate(PROBE).catch(() => null);
      if (p) results.push({ route: route.name, ...vw, ...p });
    }
    const worst = Math.max(...WIDTHS.map((w) => {
      const r = results.find((x) => x.route === route.name && x.w === w.w);
      return r ? r.overflow : 0;
    }));
    console.log(`  [${route.name.padEnd(20)}] 最大溢出 ${String(worst).padStart(4)}px`);
  }

  fs.writeFileSync(path.join(OUT, "small-screen-audit.json"), JSON.stringify(results, null, 2));

  // ---- 汇总：按 (route,width) 列出溢出 > 1 ----
  console.log("\n================ 横向溢出明细（overflow > 1px） ================");
  const bad = results.filter((r) => r.overflow > 1);
  for (const w of WIDTHS) {
    const rows = bad.filter((r) => r.w === w.w).sort((a, b) => b.overflow - a.overflow);
    console.log(`\n--- ${w.tag}（viewport ${w.w}）溢出页数 ${rows.length} ---`);
    for (const r of rows) {
      console.log(`  ${r.route.padEnd(20)} overflow=${String(r.overflow).padStart(4)}px doc=${r.docScrollWidth}/${r.docClientWidth} | 首因: ${r.offenders[0]?.sel || "-"} (right=${r.offenders[0]?.right ?? "-"}, w=${r.offenders[0]?.width ?? "-"})`);
      for (const o of r.offenders.slice(0, 3)) {
        console.log(`        · ${o.sel} right=${o.right} w=${o.width} display=${o.display} grid=${o.grid || "-"}`);
      }
    }
  }

  // ---- tiny targets 汇总 ----
  console.log("\n================ 点击区 < 24px（≤860 尤其关注） ================");
  for (const w of WIDTHS.filter((x) => x.w <= 1093)) {
    const rows = results.filter((r) => r.w === w.w && r.tinyCount > 0);
    console.log(`\n--- ${w.tag} --- 有 <24px 点击区的页面 ${rows.length}`);
    for (const r of rows.slice(0, 8)) {
      console.log(`  ${r.route.padEnd(20)} tiny=${r.tinyCount} 例: ${r.tiny[0]?.sel} ${r.tiny[0]?.w}x${r.tiny[0]?.h}`);
    }
  }

  await browser.close();
  console.log(`\n原始 JSON: ${path.join(OUT, "small-screen-audit.json")}`);
}

main().catch((e) => {
  console.error("审计中止:", e?.message || e);
  process.exitCode = 1;
});
