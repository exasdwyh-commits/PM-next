/**
 * 一次性截图（下划线前缀，不提交）：六维评分区（移植老版 ScoreSummary 的维度条）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3180";
const USER = "bbb73fbd-8a93-4c1c-9824-19bb479341dc";
const WITH_SCORE = "bbd385df-3d96-4425-bc5e-9f7cd22b4eef";
const OUT = path.resolve(process.cwd(), "..", "outputs");
fs.mkdirSync(OUT, { recursive: true });

const HOME = os.homedir();
const chrome = [
  process.env.CHROME_PATH,
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && fs.existsSync(p))[0];

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-user-id": USER } });
const page = await ctx.newPage();

await page.goto(`${BASE}/products/${WITH_SCORE}?tab=analysis`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

// 展开「查看评估明细」
await page.locator("details.hermes-details > summary", { hasText: "查看评估明细" }).first().click();
await page.waitForTimeout(500);

const grid = await page.locator(".hermes-score-grid").count();
console.log("score-grid count =", grid);
console.log("scorebar count =", await page.locator(".viz-scorebar").count());
console.log("unknown bars =", await page.locator('.viz-scorebar[data-empty="true"]').count());

await page.locator("details.hermes-details").first().screenshot({ path: path.join(OUT, "ai-ux-6-scorecard-bars.png") });
console.log("saved ai-ux-6-scorecard-bars.png");

// 窄屏 1 列
await page.setViewportSize({ width: 860, height: 1200 });
await page.waitForTimeout(600);
const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".hermes-score-grid")).gridTemplateColumns);
console.log("860px gridTemplateColumns =", cols);

await browser.close();
