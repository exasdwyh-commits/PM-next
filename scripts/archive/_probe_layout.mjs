import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100";
const ROUTE = process.env.PROBE_ROUTE || "/products";
const SELECTORS = (process.env.PROBE_SELECTORS || ".hermes-workspace,.hermes-projects-panel,.project-table-head,.project-row,.project-name,.project-name strong,.project-row > *").split(",");

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill('input[type="email"]', "li_vp@hermes.test");
await page.fill('input[type="password"]', "admin123");
await page.click('button[type="submit"]');
await page.waitForURL(BASE + "/", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);

await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

const dump = await page.evaluate((sels) => {
  const out = [];
  for (const sel of sels) {
    const nodes = [...document.querySelectorAll(sel)].slice(0, 4);
    nodes.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push({
        sel: `${sel}${nodes.length > 1 ? `[${i}]` : ""}`,
        tag: el.tagName,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        gridTemplateColumns: cs.gridTemplateColumns,
        gridColumn: cs.gridColumn,
        overflowX: cs.overflowX,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        whiteSpace: cs.whiteSpace,
        fontSize: cs.fontSize,
      });
    });
  }
  return out;
}, SELECTORS);

console.log(`=== ${ROUTE} 布局度量（viewport 1440） ===`);
for (const d of dump) {
  console.log(
    `\n${d.sel}\n  文本="${d.text}"\n  box=${d.box.w}x${d.box.h}@(${d.box.x},${d.box.y}) display=${d.display} grid=${d.gridTemplateColumns || "-"} col=${d.gridColumn} scroll/client=${d.scrollW}/${d.clientW} fs=${d.fontSize}`,
  );
}

await browser.close();
