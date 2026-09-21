/**
 * 小屏电脑自适应 · 结构度量（诊断脚本）
 * 采集：侧栏宽/显隐、内容宽/内外边距、project-row 列模板与各列显隐、decision-strip 列、
 *       hero 标题字号、bubble 高、viz 组件横向可滚性。
 * 用法： AUDIT_BASE=http://127.0.0.1:3120 ... tsx scripts/_small-screen-struct.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import os from "os";

const BASE = process.env.AUDIT_BASE || "http://127.0.0.1:3120";
const EMAIL = process.env.AUDIT_EMAIL || "li_vp@hermes.test";
const PASSWORD = process.env.AUDIT_PASSWORD || "admin123";

const WIDTHS = [
  { w: 1366, h: 768, tag: "1366" },
  { w: 1280, h: 800, tag: "1280" },
  { w: 1180, h: 720, tag: "1180" },
  { w: 1093, h: 720, tag: "1093(z125)" },
  { w: 1024, h: 768, tag: "1024" },
  { w: 853, h: 640, tag: "853(z150)" },
];

function chromePath() {
  const HOME = os.homedir();
  return [
    process.env.CHROME_PATH,
    path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  ].filter(Boolean).find((p) => fs.existsSync(p));
}

const PROBE = () => {
  const q = (s) => document.querySelector(s);
  const info = (s) => {
    const el = q(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel: s,
      display: cs.display,
      width: Math.round(r.width),
      left: Math.round(r.left),
      padL: cs.paddingLeft,
      padR: cs.paddingRight,
      grid: cs.gridTemplateColumns,
      fontSize: cs.fontSize,
      position: cs.position,
      overflowX: cs.overflowX,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
    };
  };
  const rowCells = () => {
    const row = q(".project-row");
    if (!row) return null;
    return [...row.children].map((c, i) => {
      const cs = getComputedStyle(c);
      return {
        i: i + 1,
        sel: c.tagName.toLowerCase() + "." + (c.getAttribute("class") || "").split(/\s+/).slice(0, 2).join("."),
        display: cs.display,
        w: Math.round(c.getBoundingClientRect().width),
        text: (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
      };
    });
  };
  return {
    innerWidth: window.innerWidth,
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    sidebar: info(".hermes-sidebar"),
    content: info(".hermes-content"),
    topbar: info(".hermes-topbar"),
    workspace: info(".hermes-workspace"),
    decisionStrip: info(".hermes-decision-strip"),
    metrics: info(".hermes-metrics"),
    heroH2: info(".hero-copy h2"),
    hero: info(".hermes-hero"),
    projectRow: info(".project-row"),
    questionHead: info(".project-table-head"),
    rowCells: rowCells(),
    vizSteps: info(".viz-steps"),
    vizGate: info(".viz-gate-line"),
    bubble: info(".bubble-chart"),
    progressRing: info(".progress-ring"),
    timeline: info(".viz-timeline"),
  };
};

async function main() {
  const exe = chromePath();
  if (!exe) { console.error("no chromium"); process.exitCode = 1; return; }
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, locale: "zh-CN" });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1000);

  let product = "";
  try {
    const r = await ctx.request.get(`${BASE}/api/products`);
    if (r.ok()) { const j = await r.json(); const f = (j.items || j.products || (Array.isArray(j) ? j : []))[0]; if (f?.id) product = `/products/${f.id}`; }
  } catch {}
  if (!product) {
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const h = await page.locator('a[href^="/products/"]').first().getAttribute("href").catch(() => null); if (h) product = h;
  }

  const targets = [
    { name: "home", url: "/" },
    { name: "products", url: "/products" },
    { name: "product-overview", url: product || "/products" },
    { name: "opportunities", url: "/opportunities" },
  ];

  const out = [];
  for (const t of targets) {
    await page.goto(BASE + t.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    for (const vw of WIDTHS) {
      await page.setViewportSize({ width: vw.w, height: vw.h });
      await page.waitForTimeout(400);
      const p = await page.evaluate(PROBE).catch(() => null);
      if (p) out.push({ route: t.name, tag: vw.tag, ...p });
    }
  }

  fs.writeFileSync("/tmp/hermes-small-screen/struct.json", JSON.stringify(out, null, 2));

  const line = (s) => console.log(s);
  for (const t of targets) {
    line(`\n================ ${t.name} ================`);
    for (const vw of WIDTHS) {
      const r = out.find((x) => x.route === t.name && x.tag === vw.tag);
      if (!r) continue;
      line(`\n-- ${vw.tag} (inner=${r.innerWidth}) docScroll=${r.docScroll}/${r.docClient}`);
      const sb = r.sidebar, ct = r.content;
      line(`   侧栏: ${sb ? `display=${sb.display} w=${sb.width}` : "无"} | 内容: ${ct ? `w=${ct.width} left=${ct.left} pad=${ct.padL}/${ct.padR}` : "无"}`);
      if (r.topbar) line(`   顶栏: position=${r.topbar.position} w=${r.topbar.width}`);
      if (r.workspace) line(`   workspace grid=${r.workspace.grid}`);
      if (r.decisionStrip) line(`   decision-strip grid=${r.decisionStrip.grid} w=${r.decisionStrip.width}`);
      if (r.metrics) line(`   metrics grid=${r.metrics.grid}`);
      if (r.heroH2) line(`   hero-copy h2 fontSize=${r.heroH2.fontSize}`);
      if (r.projectRow) {
        line(`   project-row grid=${r.projectRow.grid} w=${r.projectRow.width} overflowX=${r.projectRow.overflowX} scroll/client=${r.projectRow.scrollW}/${r.projectRow.clientW}`);
        if (r.rowCells) {
          const vis = r.rowCells.filter((c) => c.display !== "none");
          const hid = r.rowCells.filter((c) => c.display === "none");
          line(`     列: 共${r.rowCells.length} 可见${vis.length} 隐藏${hid.length} → 隐藏列=[${hid.map((c) => `#${c.i}:${c.text}`).join(", ")}]`);
        }
      }
      if (r.vizSteps) line(`   viz-steps w=${r.vizSteps.width} overflowX=${r.vizSteps.overflowX} scroll/client=${r.vizSteps.scrollW}/${r.vizSteps.clientW}`);
      if (r.vizGate) line(`   viz-gate-line w=${r.vizGate.width} scroll/client=${r.vizGate.scrollW}/${r.vizGate.clientW}`);
      if (r.bubble) line(`   bubble-chart h=${r.bubble.height || "?"} scroll/client=${r.bubble.scrollW}/${r.bubble.clientW}`);
      if (r.progressRing) line(`   progress-ring w=${r.progressRing.width}`);
    }
  }
  await browser.close();
  console.log("\nstruct.json 已写出");
}
main().catch((e) => { console.error("中止:", e?.message || e); process.exitCode = 1; });
