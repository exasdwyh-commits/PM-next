/**
 * 过程脚本（不提交）：多视口溢出检测（对应走查的 R1）。
 * 字号放大后必须确认没有元素被撑破。
 * 用法：node scripts/_check-overflow.mjs [tag]
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3180";
const TAG = process.argv[2] || "typo";

const VIEWPORTS = [
  ["1600", 1600, 1000],
  ["1280", 1280, 900],
  ["1180", 1180, 900],
  ["1100", 1100, 900],
  ["960", 960, 900],
  ["900", 900, 900],
  ["860", 860, 900],
  ["800", 800, 900],
  ["520", 520, 900],
];

const ROUTES = [
  ["home", "/"],
  ["products", "/products"],
  ["dashboard", "/dashboard"],
  ["detail", "/products/f0c46df9-c3f9-4319-8e5e-da2411fb96fa"],
  ["detail-analysis", "/products/f0c46df9-c3f9-4319-8e5e-da2411fb96fa?tab=analysis"],
  ["trace", "/trace"],
  ["opportunities", "/opportunities"],
  ["war-room", "/war-room"],
  ["organization", "/organization"],
  ["settings", "/settings"],
];

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const login = await ctx.request.post(`${BASE}/api/auth/session`, {
  data: { email: "zhang_pm@hermes.test", password: "hermes-dev-2026" },
});
if (!login.ok()) {
  console.error("LOGIN FAILED", login.status());
  process.exit(1);
}

const page = await ctx.newPage();
let total = 0;
const rows = [];

for (const [vpName, w, h] of VIEWPORTS) {
  await page.setViewportSize({ width: w, height: h });
  for (const [rName, path] of ROUTES) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const pageOverflow = de.scrollWidth - de.clientWidth;
      const nodes = [];
      document.querySelectorAll("body *").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.overflowX === "auto" || cs.overflowX === "scroll") return;
        if (cs.display === "none") return;
        const sw = el.scrollWidth, cw = el.clientWidth;
        if (cw > 0 && sw > cw + 2) {
          nodes.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || "").toString().slice(0, 70),
            sw, cw,
          });
        }
      });
      return { pageOverflow, nodes: nodes.slice(0, 6), total: nodes.length };
    });
    if (r.pageOverflow > 1 || r.total > 0) {
      total++;
      rows.push({ vp: vpName, route: rName, pageOverflow: r.pageOverflow, count: r.total, sample: r.nodes });
      console.log(
        `[${vpName}px] ${rName}: pageOverflow=${r.pageOverflow}px 内溢元素=${r.total}` +
          (r.nodes.length ? " e.g. " + r.nodes.map((n) => `${n.tag}.${n.cls}(${n.sw}>${n.cw})`).join(" | ") : "")
      );
    }
  }
}

console.log(`\n=== ${TAG}: ${total} / ${VIEWPORTS.length * ROUTES.length} 屏有溢出 ===`);
await browser.close();
