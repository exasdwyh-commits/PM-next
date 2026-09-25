/**
 * 一次性 UI 验证：Executive Report Renderer 是否真的渲染在项目页上。
 *
 * 用法：
 *   NODE_OPTIONS= node scripts/verify-executive-report-ui.mjs <projectId> [email] [password]
 *   REPORT_BASE_URL=http://127.0.0.1:3110   # 可选，默认 http://127.0.0.1:3100
 *
 * 验证点：
 * 1. 项目页「AI 研发」标签里出现结构化报告（**报告不再默认可见**，见下方坑 5）；
 * 2. hero（标题/摘要/状态徽章）+ 关键指标 + 各分块可见；
 * 3. 下钻区（专业数字员工意见 / 报告溯源）**闭合时读不到内容、展开后读到** ——
 *    既是「折叠确实生效」的实证，也证明展开后内容真的渲染；
 * 4. **报告容器内部**不出现原始 JSON（页面其他位置可能有别的 artifact 原文，不能拿整页 body 判）。
 *
 * 踩过的坑（勿回退）：
 * 1. 分区标题被 CSS `text-transform: uppercase` 渲染成全大写，而 JSX 源码是 Title Case；
 *    `innerText` 取到的是**渲染后**文本。匹配一律大小写不敏感。
 * 2. JSON 直出检查必须限定在 `[data-testid="executive-report"]` 容器内，
 *    否则会把页面别处的审批 artifact 原文误判成「报告 JSON 直出」。
 * 3. 截图前要把 sticky/fixed 元素压平，否则顶部导航叠在截图中间，
 *    看起来像「某个分区标题不见了」。
 * 4. **闭合的 `<details>` 内容不参与渲染**：`document.body.innerText` 取不到它，
 *    但 `querySelectorAll` 仍能找到节点。要读折叠内容必须先 `el.open = true`。
 *    反过来这也正是「内容确实被折叠」的实证手段 —— 本脚本用它做双向断言。
 * 5. **项目页已重构为标签页工作区**（概览 / AI 研发 / 任务 / 证据 / 决策 / 记录），
 *    报告只在「AI 研发」标签内渲染。旧版脚本 `goto(/projects/{id})` 后直接找报告，
 *    在重构后必然假失败 —— 必须先点标签。
 * 6. 报告的分区标题在 V3 重构后不再是 `1. 摘要`…`6. 建议动作` 这种编号标题：
 *    摘要并入 hero，未闭合项/风险/决策改为「指标 + 分块」命名
 *    （需要你决定 / 还不能下结论 / 关键风险 / 建议动作 / 结论与证据）。
 *    断言必须跟着产品契约走，而不是跟着上一版界面走。
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

const BASE = (process.env.REPORT_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
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
await page.waitForURL(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/)?(\\?.*)?$`), {
  timeout: 45000,
  waitUntil: "load",
});

// 2) 进入项目页，并切到「AI 研发」标签（报告只在该标签内渲染）
await page.goto(`${BASE}/projects/${projectId}`, {
  waitUntil: "load",
  timeout: 45000,
});
await page.waitForTimeout(1500);

const rndTab = page.getByRole("tab", { name: "AI 研发" });
const rndTabCount = await rndTab.count();
if (rndTabCount === 0) {
  console.log("❌ 未找到「AI 研发」标签（项目页标签结构可能又变了）");
  await page.screenshot({ path: "/tmp/executive-report-page.png", fullPage: true });
  await browser.close();
  process.exit(1);
}
await rndTab.first().click();
await page.waitForTimeout(2000);

/**
 * 大小写不敏感匹配：分区标题被 CSS 渲染成全大写，但源码是 Title Case。
 * 用 toUpperCase() 归一化两边，避免再次被 text-transform 坑到。
 */
const norm = (s) => (s || "").toUpperCase();

// 报告容器（稳定测试锚点）：用于把 JSON 检查与折叠断言限定在报告内部
const reportEl = page.locator('[data-testid="executive-report"]').first();
const emptyEl = page.locator('[data-testid="executive-report-empty"]').first();
const hasReport = (await reportEl.count()) > 0;
const hasEmpty = (await emptyEl.count()) > 0;

// 闭合状态下的报告文本
const reportTextClosed = hasReport ? (await reportEl.innerText()) || "" : "";
const hasClosed = (needle) => norm(reportTextClosed).includes(norm(needle));

// 报告容器里若出现这些串，说明 JSON 原文被直接丢上页面了
const JSON_ARTIFACTS = ['"schemaVersion"', '"verificationStatus"', '"contentVersion"'];
const leakedJson = hasReport
  ? JSON_ARTIFACTS.filter((k) => reportTextClosed.includes(k))
  : [];

/** 折叠区：内容只在展开后参与渲染（见坑 4） */
const FOLDED_MARKERS = ["证据来源", "执行记录", "模型调用", "知识债"];
const foldedVisibleWhileClosed = FOLDED_MARKERS.filter((k) => hasClosed(k));

const checks = [
  ["「AI 研发」标签可打开", rndTabCount > 0],
  ["管理报告渲染器（报告容器存在）", hasReport],
  ["未落入空态（说明 latestReport 已合成）", !hasEmpty],
  ["hero 眉标（EXECUTIVE REPORT）", hasClosed("EXECUTIVE REPORT")],
  ["负责人视角结论（负责人现在最需要知道）", hasClosed("负责人现在最需要知道")],
  ["指标 · 未闭合项", hasClosed("未闭合项")],
  ["指标 · 显式风险", hasClosed("显式风险")],
  ["指标 · 需负责人决策", hasClosed("需负责人决策")],
  ["指标 · 有效结论", hasClosed("有效结论")],
  ["分块 · 需要你决定", hasClosed("需要你决定")],
  ["分块 · 还不能下结论", hasClosed("还不能下结论")],
  ["分块 · 建议动作", hasClosed("建议动作")],
  ["分块 · 结论与证据", hasClosed("结论与证据")],
  ["下钻 · 专业数字员工意见（summary 可见）", hasClosed("查看专业数字员工意见")],
  ["下钻 · 报告溯源（summary 可见）", hasClosed("查看报告溯源")],
  [
    `折叠确实生效（闭合时读不到折叠区内容${foldedVisibleWhileClosed.length ? `，却读到了：${foldedVisibleWhileClosed.join(",")}` : ""}）`,
    hasReport && foldedVisibleWhileClosed.length === 0,
  ],
  [
    `报告容器内无 JSON 原文直出${leakedJson.length ? `（泄漏：${leakedJson.join(",")}）` : ""}`,
    leakedJson.length === 0,
  ],
];

// 3) 展开全部折叠区后再断言内容真的渲染出来
await page.evaluate(() => {
  document
    .querySelectorAll('[data-testid="executive-report"] details')
    .forEach((d) => {
      d.open = true;
    });
});
await page.waitForTimeout(400);
const reportTextOpen = hasReport ? (await reportEl.innerText()) || "" : "";
const hasOpen = (needle) => norm(reportTextOpen).includes(norm(needle));
const foldedNowVisible = FOLDED_MARKERS.filter((k) => hasOpen(k));

checks.push(
  [
    `展开后折叠区内容渲染${foldedNowVisible.length ? `（命中：${foldedNowVisible.join(",")}）` : ""}`,
    foldedNowVisible.length > 0,
  ],
  [
    `展开后文本量增加（闭合 ${reportTextClosed.length} → 展开 ${reportTextOpen.length}）`,
    reportTextOpen.length > reportTextClosed.length,
  ]
);

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failed += 1;
}

// 关键风险块是有条件的（仅 risks.length > 0 时渲染），因此只作信息输出，不作判据
console.log(
  `${hasClosed("关键风险") ? "ℹ️ " : "ℹ️ "} 关键风险分块：${hasClosed("关键风险") ? "存在" : "本报告无显式风险（该块按条件渲染）"}`
);

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
    await page
      .screenshot({ path: "/tmp/executive-report-panel.png", fullPage: true })
      .catch(() => {});
  });
await page.screenshot({ path: "/tmp/executive-report-page.png", fullPage: true });
console.log("截图: /tmp/executive-report-panel.png（报告容器）, /tmp/executive-report-page.png（整页）");

if (problems.length) {
  console.log("页面告警：");
  for (const p of problems) console.log("  -", p);
}

if (process.env.PM_UI_DEBUG === "1") {
  const traceIdx = norm(reportTextOpen).indexOf(norm("溯源"));
  console.log(
    "\n[debug] 溯源 上下文:",
    JSON.stringify(reportTextOpen.slice(Math.max(0, traceIdx - 120), traceIdx + 200))
  );
  console.log(
    "[debug] 报告容器命中:",
    hasReport ? "是" : "否",
    "空态:",
    hasEmpty ? "是" : "否",
    "折叠区数量:",
    await page.locator('[data-testid="executive-report"] details').count()
  );
  console.log("[debug] 容器内 JSON 泄漏项:", JSON.stringify(leakedJson));
}

await browser.close();
process.exitCode = failed ? 1 : 0;
