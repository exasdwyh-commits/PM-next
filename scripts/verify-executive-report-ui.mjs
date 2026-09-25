/**
 * 一次性 UI 验证：Executive Report Renderer 是否真的渲染在项目页上。
 *
 * 用法：
 *   NODE_OPTIONS= node scripts/verify-executive-report-ui.mjs <projectId> [email] [password]
 *
 * 验证点：
 * 1. 项目页出现「数字员工流水线」面板（此前这段 UI 从未被渲染）；
 * 2. 面板内出现「产品研发管理报告」结构化视图（而不是 JSON 原文）；
 * 3. 报告的 9 个分区标题存在（摘要/结论与证据/未闭合项/风险/需负责人决策/建议动作/
 *    数字员工意见/溯源）；
 * 4. **报告容器内部**不出现原始 JSON（页面其他位置可能有别的 artifact 原文，
 *    不能拿整页 body 去判——那样会误报）。
 *
 * 两个曾经踩过的坑（本次修正）：
 * - 分区标题在 `.hermes-section-label` 上被 CSS `text-transform: uppercase` 渲染，
 *   `innerText` 取到的是**渲染后**全大写文本（`溯源（PROVENANCE）`），
 *   而 JSX 源码里写的是 `溯源（Provenance）`。因此匹配一律大小写不敏感。
 * - JSON 直出检查必须限定在 `[data-testid="executive-report"]` 容器内，
 *   否则会把页面别处的审批 artifact 原文误判成「报告 JSON 直出」。
 */
import { chromium } from "playwright";

const [
  projectId,
  email = "zhang_pm@hermes.test",
  password = "hermes1234",
] = process.argv.slice(2);

if (!projectId) {
  console.error("用法: node scripts/verify-executive-report-ui.mjs <projectId>");
  process.exit(1);
}

const BASE = "http://127.0.0.1:3100";
const browser = await chromium.launch();
const page = await browser.newPage();

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console.error: ${m.text().slice(0, 200)}`);
});

// 1) 登录
await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 30000 });
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click('button[type="submit"]');
await page.waitForURL(/127\.0\.0\.1:3100(\/)?(\?.*)?$/, {
  timeout: 45000,
  waitUntil: "load",
});

// 2) 进入项目页
await page.goto(`${BASE}/projects/${projectId}`, {
  waitUntil: "load",
  timeout: 45000,
});
await page.waitForTimeout(2500);

const bodyText = (await page.locator("body").innerText()) || "";

/**
 * 大小写不敏感匹配：分区标题被 CSS 渲染成全大写，但源码是 Title Case。
 * 用 toUpperCase() 归一化两边，避免再次被 text-transform 坑到。
 */
const norm = (s) => (s || "").toUpperCase();
const has = (needle) => norm(bodyText).includes(norm(needle));

// 报告容器（新增的稳定测试锚点）：用于把 JSON 检查限定在报告内部
const reportEl = page.locator('[data-testid="executive-report"]').first();
const emptyEl = page.locator('[data-testid="executive-report-empty"]').first();
const hasReport = (await reportEl.count()) > 0;
const hasEmpty = (await emptyEl.count()) > 0;
const reportText = hasReport ? (await reportEl.innerText()) || "" : "";

// 报告容器里若出现这些串，说明 JSON 原文被直接丢上页面了
const JSON_ARTIFACTS = ['"schemaVersion"', '"verificationStatus"', '"contentVersion"'];
const leakedJson = hasReport
  ? JSON_ARTIFACTS.filter((k) => reportText.includes(k))
  : [];

const checks = [
  ["数字员工流水线面板", has("数字员工流水线")],
  ["管理报告渲染器（报告容器存在）", hasReport],
  ["未落入空态（说明 latestReport 已合成）", !hasEmpty],
  ["1. 摘要", has("1. 摘要")],
  ["2. 结论与证据", has("2. 结论与证据")],
  ["3. 未闭合项", has("3. 未闭合项")],
  ["4. 风险", has("4. 风险")],
  ["5. 需负责人决策", has("5. 需负责人决策")],
  ["6. 建议动作", has("6. 建议动作")],
  ["数字员工意见", has("数字员工意见")],
  ["溯源（Provenance，大小写不敏感）", has("溯源（Provenance")],
  [
    `报告容器内无 JSON 原文直出${leakedJson.length ? `（泄漏：${leakedJson.join(",")}）` : ""}`,
    leakedJson.length === 0,
  ],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failed += 1;
}

const verifiedBadge = await page
  .locator("text=待负责人审查")
  .first()
  .isVisible()
  .catch(() => false);
console.log(
  `${verifiedBadge ? "✅" : "⚠️ "} 报告状态徽章（QA 已通过 · 待负责人审查）`
);

// 截图：优先只截报告容器本身，便于人工核对版式；失败再退化为整页。
// 注意：element.screenshot 会把 sticky/fixed 元素（顶部导航）叠在截图中间，
// 造成「某个分区标题不见了」的假象。截图前先把这类元素压平，保证截图可信。
await page.evaluate(() => {
  document.querySelectorAll("*").forEach((el) => {
    const pos = getComputedStyle(el).position;
    if (pos === "sticky" || pos === "fixed") {
      el.style.position = "static";
    }
  });
});
await reportEl
  .screenshot({ path: "/tmp/executive-report-panel.png" })
  .catch(async () => {
    const panel = page
      .locator("section, div")
      .filter({ hasText: "数字员工流水线" })
      .first();
    await panel.screenshot({ path: "/tmp/executive-report-panel.png" }).catch(async () => {
      await page.screenshot({ path: "/tmp/executive-report-panel.png", fullPage: true });
    });
  });
await page.screenshot({ path: "/tmp/executive-report-page.png", fullPage: true });
console.log("截图: /tmp/executive-report-panel.png（报告容器）, /tmp/executive-report-page.png（整页）");

if (problems.length) {
  console.log("页面告警：");
  for (const p of problems) console.log("  -", p);
}

if (process.env.PM_UI_DEBUG === "1") {
  const traceIdx = norm(bodyText).indexOf(norm("溯源"));
  console.log("\n[debug] 溯源 上下文:", JSON.stringify(
    bodyText.slice(Math.max(0, traceIdx - 120), traceIdx + 160)
  ));
  console.log("[debug] 报告容器命中:", hasReport ? "是" : "否", "空态:", hasEmpty ? "是" : "否");
  console.log("[debug] 报告容器文本长度:", reportText.length);
  console.log("[debug] 报告容器内 JSON 泄漏项:", JSON.stringify(leakedJson));
}

await browser.close();
process.exitCode = failed ? 1 : 0;
