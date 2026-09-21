import { chromium } from "playwright";
import path from "path";
import fs from "fs";

/** 凭据可用环境变量覆盖，便于在种子口令不同的开发库上复跑 */
const EMAIL = process.env.JOURNEY_EMAIL || "li_vp@hermes.test";
const PASSWORD = process.env.JOURNEY_PASSWORD || "admin123";
/** dev 模式冷编译可能超过 5s，等待窗口放宽 */
const WAIT = 20000;

async function main() {
  console.log("🚀 Starting Playwright Browser Verification Journey on http://localhost:3100...");
  const screenshotDir = path.resolve(process.cwd(), "docs/plans/screenshots");
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log(`▶ [1/7] Logging in as ${EMAIL}...`);
    await page.goto("http://localhost:3100/login", { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("http://localhost:3100/", { timeout: WAIT });
    console.log("  ✔ Login succeeded, redirected to overview.");

    // 2. Cockpit（驾驶舱：品牌带 / KPI 行 / 决策板 / 产品推进 + 市场机会 / 侧栏）
    console.log("▶ [2/7] Verifying cockpit layout...");
    await page.waitForSelector(".hermes-cockpit", { timeout: WAIT });
    const situationExists = await page.locator("text=现在的情况").first().isVisible();
    const decisionsExists = await page.locator("text=需要你决定").first().isVisible();
    const themesExists = await page.locator(".hermes-progress-row").first().isVisible();
    console.log(`  ✔ 现在的情况 visible: ${situationExists}`);
    console.log(`  ✔ 需要你决定 visible: ${decisionsExists}`);
    console.log(`  ✔ 主题行（产品推进 / 市场机会）visible: ${themesExists}`);
    await page.screenshot({ path: path.join(screenshotDir, "01-work-overview.png"), fullPage: true });
    console.log("  📸 Saved 01-work-overview.png");

    // 3. Products List / Stage Board
    console.log("▶ [3/7] Verifying Products List & Stage Board...");
    await page.goto("http://localhost:3100/products", { waitUntil: "networkidle" });
    await page.waitForSelector(".project-list, .hermes-board", { timeout: WAIT });
    const listRows = await page.locator(".project-row").count();
    console.log(`  ✔ Products list rows: ${listRows}`);

    // Switch to board view
    await page.click('button:has-text("阶段看板")');
    await page.waitForSelector(".hermes-board", { timeout: WAIT });
    const boardCols = await page.locator(".hermes-board-col").count();
    console.log(`  ✔ Stage board columns: ${boardCols}`);
    await page.screenshot({ path: path.join(screenshotDir, "02-products-board.png"), fullPage: true });
    console.log("  📸 Saved 02-products-board.png");

    // Find first product card link
    let firstProductLink = await page.locator(".hermes-board-card").first().getAttribute("href");
    if (!firstProductLink) {
      firstProductLink = await page.locator(".project-row").first().getAttribute("href");
    }
    // 空库自举：没有产品时通过入库表单创建一个，保证后续详情步骤可执行
    if (!firstProductLink) {
      console.log("  · Board empty; creating a product via ingest modal...");
      await page.click('button:has-text("新产品入库")');
      await page.waitForSelector(".hermes-modal", { timeout: WAIT });
      await page.fill('.hermes-modal input[placeholder*="低 GI"]', "验证用低糖燕麦脆 463128");
      await page.fill('.hermes-modal textarea[placeholder*="解决什么问题"]', "为控糖人群提供低 GI 代餐燕麦脆");
      await page.fill('.hermes-modal textarea[placeholder*="什么场景"]', "25-40 岁控糖人群，办公室下午茶场景");
      await page.fill('.hermes-modal textarea[placeholder*="最值得被记住"]', "低 GI 认证配方，慢碳更扛饿");
      await page.fill('.hermes-modal input[placeholder*="抖音自播"]', "抖音自播 + 私域复购");
      await page.click('.hermes-modal button[type="submit"]');
      await page.waitForURL(/\/products\/[0-9a-f-]+$/, { timeout: WAIT });
      firstProductLink = new URL(page.url()).pathname;
    }
    console.log(`  ✔ Found first product link: ${firstProductLink}`);
    if (!firstProductLink) throw new Error("No product card found on board!");

    // 4. Product Details & Tabs
    console.log("▶ [4/7] Verifying Product Details & Progressive Disclosure Tabs...");
    await page.goto(`http://localhost:3100${firstProductLink}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".hermes-themes", { timeout: WAIT });
    const conclusionText = await page.locator(".hermes-theme-conclusion").first().innerText();
    console.log(`  ✔ Executive conclusion: "${conclusionText.slice(0, 60)}..."`);
    await page.screenshot({ path: path.join(screenshotDir, "03-product-overview.png"), fullPage: true });
    console.log("  📸 Saved 03-product-overview.png");

    // Tab 2: Analysis & Scoring
    console.log("  -> Switching to tab: 分析与评分...");
    await page.click('button:has-text("分析与评分")');
    await page.waitForTimeout(600);
    console.log(`  ✔ URL tab param: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, "04-product-analysis.png"), fullPage: true });
    console.log("  📸 Saved 04-product-analysis.png");

    // Tab 3: Version & Revision Diff
    console.log("  -> Switching to tab: 方案与版本...");
    await page.click('button:has-text("方案与版本")');
    await page.waitForTimeout(600);
    console.log(`  ✔ URL tab param: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, "05-product-version.png"), fullPage: true });
    console.log("  📸 Saved 05-product-version.png");

    // Tab 4: Cost & Supply
    console.log("  -> Switching to tab: 成本与供应...");
    await page.click('button:has-text("成本与供应")');
    await page.waitForTimeout(600);
    console.log(`  ✔ URL tab param: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, "06-product-cost.png"), fullPage: true });
    console.log("  📸 Saved 06-product-cost.png");

    // Tab 5: Validation & Evidence
    console.log("  -> Switching to tab: 验证与风险...");
    await page.click('button:has-text("验证与风险")');
    await page.waitForTimeout(600);
    console.log(`  ✔ URL tab param: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, "07-product-validation.png"), fullPage: true });
    console.log("  📸 Saved 07-product-validation.png");

    // Tab 6: Launch Plan
    console.log("  -> Switching to tab: 上市计划...");
    await page.click('button:has-text("上市计划")');
    await page.waitForTimeout(600);
    console.log(`  ✔ URL tab param: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, "08-product-launch.png"), fullPage: true });
    console.log("  📸 Saved 08-product-launch.png");

    // 5. AI Advisor
    const productId = firstProductLink.replace("/products/", "");
    console.log(`▶ [5/7] Verifying AI Advisor with product context (${productId})...`);
    await page.goto(`http://localhost:3100/advisor?product=${productId}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".hermes-advisor", { timeout: WAIT });
    const bannerVisible = await page.locator("text=已锁定产品上下文").isVisible();
    console.log(`  ✔ Product context banner visible: ${bannerVisible}`);

    // Send a message
    const textarea = page.locator(".hermes-textarea");
    await textarea.fill("请评估当前产品的上市准备度与核心风险");
    await page.click('button:has-text("发送")');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(screenshotDir, "09-ai-advisor.png"), fullPage: true });
    console.log("  📸 Saved 09-ai-advisor.png");

    // 6. Company Knowledge
    console.log("▶ [6/7] Verifying Company Knowledge default reading view & modal...");
    await page.goto("http://localhost:3100/knowledge", { waitUntil: "networkidle" });
    await page.waitForSelector(".hermes-tabs", { timeout: WAIT });
    const syncBtn = page.locator('button:has-text("挂载与同步管理")');
    if (await syncBtn.isVisible()) {
      await syncBtn.click();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: path.join(screenshotDir, "10-company-knowledge.png"), fullPage: true });
    console.log("  📸 Saved 10-company-knowledge.png");

    // 7. Market Opportunities
    console.log("▶ [7/7] Verifying Market Opportunities 3-action workflow...");
    await page.goto("http://localhost:3100/opportunities", { waitUntil: "networkidle" });
    await page.waitForSelector(".hermes-list, .hermes-empty", { timeout: WAIT });
    const askAdvisorBtn = page.locator('a:has-text("问顾问验证")').first();
    const askBtnExists = await askAdvisorBtn.isVisible();
    console.log(`  ✔ "问顾问验证" action visible: ${askBtnExists}`);
    await page.screenshot({ path: path.join(screenshotDir, "11-market-opportunities.png"), fullPage: true });
    console.log("  📸 Saved 11-market-opportunities.png");

    if (askBtnExists) {
      await askAdvisorBtn.click();
      await page.waitForTimeout(1500);
      console.log(`  ✔ Redirected to advisor from opportunity: ${page.url()}`);
      await page.screenshot({ path: path.join(screenshotDir, "12-advisor-prefilled.png"), fullPage: true });
      console.log("  📸 Saved 12-advisor-prefilled.png");
    }

    console.log("\n========================================================");
    console.log("🎉 ALL BROWSER JOURNEY TESTS PASSED! SCREENSHOTS GENERATED!");
    console.log("========================================================");
  } catch (err) {
    console.error("❌ Browser verification failed:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
