/**
 * 一次性全页截图（下划线前缀，不提交）：看整页组合，而不是单张卡。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3180";
const USER = "bbb73fbd-8a93-4c1c-9824-19bb479341dc";
const WITH_SCORE = "bbd385df-3d96-4425-bc5e-9f7cd22b4eef";
const NO_SCORE = "f0c46df9-c3f9-4319-8e5e-da2411fb96fa";
const OUT = path.resolve(process.cwd(), "..", "outputs", "full");

fs.mkdirSync(OUT, { recursive: true });
const HOME = os.homedir();
const chrome = [
  process.env.CHROME_PATH,
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && fs.existsSync(p))[0];

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, extraHTTPHeaders: { "x-user-id": USER } });
const page = await ctx.newPage();

for (const [id, tag] of [
  [WITH_SCORE, "score"],
  [NO_SCORE, "empty"],
]) {
  for (const t of ["analysis", "version", "validation"]) {
    await page.goto(`${BASE}/products/${id}?tab=${t}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 1440, height: Math.min(h + 40, 4000) });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${tag}-${t}.png`) });
    console.log("saved", `${tag}-${t}.png`, "h=", h);
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
}
await browser.close();
