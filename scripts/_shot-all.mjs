/**
 * 一次性全站盘点（下划线前缀，不提交）：按 rev4 视觉方向逐页核对。
 * 输出：<repo>/../outputs/audit/<name>.png
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

const ROUTES = [
  ["/", "home"],
  ["/products", "products"],
  [`/products/${PRODUCT}`, "product"],
  ["/projects", "projects"],
  ["/opportunities", "opportunities"],
  ["/advisor", "advisor"],
  ["/knowledge", "knowledge"],
  ["/trace", "trace"],
  ["/dashboard", "dashboard"],
  ["/war-room", "war-room"],
  ["/consultation", "consultation"],
  ["/organization", "organization"],
  ["/settings", "settings"],
];

const HOME = os.homedir();
const chrome = [
  process.env.CHROME_PATH,
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && fs.existsSync(p))[0];

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, extraHTTPHeaders: { "x-user-id": USER } });
const page = await ctx.newPage();

for (const [r, name] of ROUTES) {
  const res = await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(h + 20, 3200) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`${name.padEnd(14)} status=${res && res.status()} h=${h} sw=${sw}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
await browser.close();
