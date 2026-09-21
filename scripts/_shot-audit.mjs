/**
 * 一次性截图（下划线前缀，不提交）：现状盘点 —— 首页 / 产品列表 / 产品详情。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3180";
const USER = "bbb73fbd-8a93-4c1c-9824-19bb479341dc";
const PRODUCT = "bbd385df-3d96-4425-bc5e-9f7cd22b4eef";
const OUT = path.resolve(process.cwd(), "..", "outputs", "audit");
fs.mkdirSync(OUT, { recursive: true });

const HOME = os.homedir();
const chrome = [
  process.env.CHROME_PATH,
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && fs.existsSync(p))[0];

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, extraHTTPHeaders: { "x-user-id": USER } });
const page = await ctx.newPage();

const routes = [
  ["/", "home"],
  ["/products", "products"],
  [`/products/${PRODUCT}`, "product"],
  ["/opportunities", "opportunities"],
  ["/dashboard", "dashboard"],
];

for (const [r, name] of routes) {
  await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(h + 20, 3000) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name, "h=", h);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
await browser.close();
