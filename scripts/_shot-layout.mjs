/**
 * 过程脚本（不提交）：截图当前 UI 排版，用于改版前后对比。
 * 用法：node scripts/_shot-layout.mjs <outDir> [tag]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.argv[2] || "/tmp/hermes-layout";
const TAG = process.argv[3] || "shot";
const W = parseInt(process.env.SHOT_W || "1600", 10);
const H = parseInt(process.env.SHOT_H || "1000", 10);
const BASE = "http://127.0.0.1:3180";

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
});

// 登录：context.request 与 context 共享 cookie jar
const login = await ctx.request.post(`${BASE}/api/auth/session`, {
  data: { email: "zhang_pm@hermes.test", password: "hermes-dev-2026" },
});
if (!login.ok()) {
  console.error("LOGIN FAILED", login.status(), await login.text());
  process.exit(1);
}
console.log("login ok");

const page = await ctx.newPage();
const routes = [
  ["home", "/"],
  ["dashboard", "/dashboard"],
  ["products", "/products"],
  ["product-detail", "/products/f0c46df9-c3f9-4319-8e5e-da2411fb96fa"],
  ["product-analysis", "/products/f0c46df9-c3f9-4319-8e5e-da2411fb96fa?tab=analysis"],
  ["trace", "/trace"],
  ["opportunities", "/opportunities"],
  ["war-room", "/war-room"],
];

for (const [name, path] of routes) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${TAG}-${name}.png`, fullPage: true });
  // 同时抓首屏（不滚动），用于观察密度
  await page.screenshot({ path: `${OUT}/${TAG}-${name}-fold.png`, fullPage: false });
  console.log("shot", name);
}

// 关键：实测字号的真实计算值，而不是只看 CSS 声明
const typo = await page.evaluate(() => {
  const out = {};
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily.slice(0, 60),
      color: cs.color,
      letterSpacing: cs.letterSpacing,
    };
  };
  out.body = pick("body");
  out.h1 = pick("h1");
  out.h2 = pick("h2");
  out.h3 = pick("h3");
  out.p = pick("p");
  out.small = pick("small");
  // 统计页面上所有文字节点的字号分布
  const hist = {};
  document.querySelectorAll("body *").forEach((el) => {
    if (!el.textContent || !el.textContent.trim()) return;
    if (el.children.length && Array.from(el.children).some((c) => c.textContent && c.textContent.trim())) return;
    const fs = getComputedStyle(el).fontSize;
    hist[fs] = (hist[fs] || 0) + 1;
  });
  out.fontSizeHistogram = Object.entries(hist).sort(
    (a, b) => parseFloat(b[0]) - parseFloat(a[0])
  );
  return out;
});
console.log("TYPO:", JSON.stringify(typo, null, 2));
fs.writeFileSync(`${OUT}/${TAG}-typo.json`, JSON.stringify(typo, null, 2));

await browser.close();
console.log("done ->", OUT);
