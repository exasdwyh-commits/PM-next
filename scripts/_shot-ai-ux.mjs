/**
 * 一次性截图（下划线前缀，不提交）：AI 判断卡 rev2。
 * 输出：<repo>/../outputs/ai-ux-*.png
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3180";
const USER = "bbb73fbd-8a93-4c1c-9824-19bb479341dc";
const WITH_SCORE = "bbd385df-3d96-4425-bc5e-9f7cd22b4eef";
const NO_SCORE = process.env.NO_SCORE_ID || "f0c46df9-c3f9-4319-8e5e-da2411fb96fa";

const OUT = path.resolve(process.cwd(), "..", "outputs");
fs.mkdirSync(OUT, { recursive: true });

const HOME = os.homedir();
const chrome = [
  process.env.CHROME_PATH,
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && fs.existsSync(p))[0];

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-user-id": USER } });
const page = await ctx.newPage();

const shot = async (name, sel) => {
  const el = sel ? page.locator(sel).first() : null;
  const target = el && (await el.count()) > 0 ? el : page;
  await target.screenshot({ path: path.join(OUT, name) });
  console.log("saved", name);
};

// 1) 有结论：判断卡（默认态）
await page.goto(`${BASE}/products/${WITH_SCORE}?tab=analysis`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
await shot("ai-ux-1-verdict-card.png", ".hermes-stack > .hermes-glass");

// 2) 有结论：展开纠错区（按钮文案会从「结论有误？」变成「收起纠错」，故用稳定选择器）
const fixBtn = page.locator(".hermes-ai-actions button").nth(1);
if ((await fixBtn.count()) > 0) {
  await fixBtn.click();
  await page.waitForTimeout(400);
  await shot("ai-ux-2-verdict-fix-open.png", ".hermes-stack > .hermes-glass");
  await fixBtn.click();
  await page.waitForTimeout(300);
}

// 3) 无结论：空态判断卡（夹具已用完时如实提示，不产出假的「空态」截图）
await page.goto(`${BASE}/products/${NO_SCORE}?tab=analysis`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1600);
if ((await page.locator(".hermes-ai-rail").count()) > 0) {
  console.log("SKIP ai-ux-3：dev 库已无「0 分析轮次」的干净夹具，该产品已有结论，再截会失真。");
} else {
  await shot("ai-ux-3-verdict-empty.png", ".hermes-stack > .hermes-glass");
}

// 4) 无结论：总览简报的动作条
await page.goto(`${BASE}/products/${NO_SCORE}?tab=overview`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await shot("ai-ux-4-brief-actions.png", ".hermes-brief-page");

// 5) 390px 移动端
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/products/${WITH_SCORE}?tab=analysis`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1600);
await shot("ai-ux-5-mobile-390.png", ".hermes-stack > .hermes-glass");

await browser.close();
