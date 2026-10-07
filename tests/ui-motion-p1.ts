/**
 * 动效 P1 回归（KX-28）：骨架 / 列表错峰与位置反馈 / 标签底板滑动与内容切换 / 页面内提示 / 抽屉退出。
 *
 * 运行：npm run test:ui-motion（和 P0 同一次构建，依次跑两套；夹具自建自清理，只清本套 RUN_TAG）。
 * 截图写到 outputs/ui-motion-p1/（不入库）。
 *
 * 覆盖：
 *  - 首次读取出现骨架，读完直接换成内容；列表首屏轻错峰，之后刷新只动变化项；
 *  - 置顶：被置顶项滑到顶部（transform），删除最后一项时其它项不动；
 *  - 产品 / 项目标签：选中底板平滑移动，内容短暂淡入，视野不跳；方向键可切换；
 *  - 提示：成功自动淡出（悬停暂停），失败常驻、可手动关闭；
 *  - 抽屉：关闭有退出过渡、焦点回到触发按钮；退出途中重开不被误关；
 *  - 手机 390 / 320 不溢出；减少动态效果时立即切换、信息完整；全程无控制台错误、无重复请求。
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";

const { chromium } = require("playwright");

/** 浏览器候选：CHROME_PATH → playwright 自己解析的版本 → 本机已下载的 chromium（新版优先）→ 系统 Chrome / Edge。 */
function findChrome(): string | undefined {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cacheDirs = [path.join(home, "AppData/Local/ms-playwright"), path.join(home, ".cache/ms-playwright"), path.join(home, "Library/Caches/ms-playwright")];
  const cached = cacheDirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9))).flatMap((d) => [
        path.join(dir, d, "chrome-win64/chrome.exe"),
        path.join(dir, d, "chrome-win/chrome.exe"),
        path.join(dir, d, "chrome-linux/chrome"),
        path.join(dir, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
      ]);
    } catch { return []; }
  });
  let bundled: string | undefined;
  try { bundled = chromium.executablePath(); } catch { bundled = undefined; }
  return [process.env.CHROME_PATH, bundled, ...cached, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
    .find((p): p is string => !!p && fs.existsSync(p));
}

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3219";
const RUN_TAG = `uimp${Date.now()}`;
const PASSWORD = `UiMo-${crypto.randomBytes(6).toString("hex")}!`;
const SHOTS = path.join(process.cwd(), "outputs", "ui-motion-p1");

let passed = 0;
const failures: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log(`  ✔ ${msg}`); }
  else { failures.push(msg); console.log(`  ❌ ${msg}`); }
}
function section(title: string) { console.log(`\n▶ ${title}`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 某元素当前在跑的动画数（含 CSS 动画与 WAAPI）；元素不存在返回 -1。 */
const animCount = (page: any, selector: string) =>
  page.evaluate((s: string) => { const el = document.querySelector(s); return el ? el.getAnimations().length : -1; }, selector);
const count = (page: any, selector: string) => page.locator(selector).count();
/** 被横向挤动的滚动容器（scrollLeft ≠ 0）——焦点或 scrollIntoView 把 overflow:hidden 的布局容器横移时会出现。 */
const shifted = (page: any): Promise<string[]> => page.evaluate(() => [document.scrollingElement!, ...Array.from(document.querySelectorAll("body *"))]
  .filter((el) => Math.abs(el.scrollLeft) > 0.5)
  .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String((el as HTMLElement).className || "").split(" ").slice(0, 2).join(".")}=${Math.round(el.scrollLeft)}`));


/** 伪元素 ::before 的当前 transform 横向位移（px）。 */
const inkX = (page: any, selector: string): Promise<number> =>
  page.evaluate((s: string) => {
    const el = document.querySelector(s);
    if (!el) return NaN;
    const t = getComputedStyle(el, "::before").transform;
    if (!t || t === "none") return 0;
    return new DOMMatrixReadOnly(t).m41;
  }, selector);
/** 当前选中标签相对标签栏的横向位置（px），用于核对底板最终落点。 */
const activeTabX = (page: any, selector: string): Promise<number> =>
  page.evaluate((s: string) => (document.querySelector(`${s} [role="tab"][aria-selected="true"]`) as HTMLElement | null)?.offsetLeft ?? NaN, selector);
const overflowX = (page: any): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function login(page: any, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u: URL) => !u.toString().includes("/login"), { timeout: 20000 });
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  fs.mkdirSync(SHOTS, { recursive: true });
  const healthOk = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  ok(healthOk, `运行前探活 ${BASE}/api/health`);
  if (!healthOk) return finish();

  // ---------- 夹具 ----------
  const org = await prisma.organization.create({ data: { code: `${RUN_TAG}_ORG`, name: "动效 P1 回归机构（合成夹具）" } });
  const user = await prisma.user.create({
    data: {
      email: `${RUN_TAG}@hermes.test`, name: "动效回归", organizationId: org.id, passwordHash: hashPassword(PASSWORD),
      orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } },
    },
  });
  const conversation = await prisma.conversation.create({ data: { organizationId: org.id, ownerId: user.id, title: `${RUN_TAG} 对话` } });
  const now = Date.now();
  await prisma.kernMemory.createMany({
    data: [1, 2, 3, 4].map((i) => ({
      organizationId: org.id, userId: user.id, kind: "PREFERENCE" as const,
      content: `P1 记忆 ${i}：${"用于验证列表位置反馈。".repeat(2)}`, createdAt: new Date(now - i * 60_000),
    })),
  });
  const product = await prisma.product.create({
    data: { organizationId: org.id, name: "动效回归产品", identityCode: `${RUN_TAG}-PRODUCT`, targetAudience: "合成夹具人群", marketPath: "私域", devMode: "NEW_PRODUCT" },
  });
  const productVersion = await prisma.productVersion.create({
    data: { productId: product.id, versionTag: `${RUN_TAG}-v1`, specs: { netWeight: "10g" }, targetCost: 12, currency: "CNY", isConfirmed: true, isImmutable: true },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id, title: `${RUN_TAG}_回归项目`, target: "验证标签切换", mode: "NEW_PRODUCT", stage: "RESEARCH",
      ownerId: user.id, decisionMakerId: user.id, productId: product.id, productVersionId: productVersion.id, revision: 1,
    },
  });
  await prisma.projectMember.createMany({ data: [{ projectId: project.id, userId: user.id, role: "OWNER" }] });

  const executablePath = findChrome();
  if (!executablePath) throw new Error("未找到 chromium 可执行文件（可设置 CHROME_PATH）");
  console.log(`  · 浏览器：${executablePath}`);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
  const consoleErrors: string[] = [];
  const watch = (page: any, tag: string) => {
    page.on("console", (m: any) => {
      if (m.type() !== "error") return;
      // 「接口失败」用例故意让分析接口返回 500，浏览器会记一条资源加载错误；只豁免这一条。
      const where = String(m.location?.()?.url || "");
      if (/status of 500/.test(m.text()) && /\/analyses$/.test(where)) return;
      consoleErrors.push(`[${tag}] ${m.text().slice(0, 200)} ${where}`.trim());
    });
    page.on("pageerror", (e: any) => consoleErrors.push(`[${tag}] pageerror ${String(e?.message || e).slice(0, 200)}`));
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    watch(page, "desktop");
    await login(page, user.email);

    // ---------------------------------------------------------------- 骨架 / 错峰 / 位置反馈
    section("对话页面板：首次读取骨架、列表错峰、位置反馈");
    await page.goto(`${BASE}/muse?c=${conversation.id}`, { waitUntil: "networkidle" });
    let memoryGets = 0;
    await page.route("**/api/memory", async (route: any) => {
      if (route.request().method() !== "GET") return route.continue();
      memoryGets += 1;
      await sleep(900); // 慢网
      return route.continue();
    });
    await page.click('.m-top-acts button[aria-label="记忆"]');
    await page.waitForSelector(".m-sheet", { state: "visible" });
    await sleep(150);
    ok(await count(page, ".m-sheet .m-skel[role=status]") === 1, "慢网首次读取时出现骨架（role=status，读屏能听到「读取中」）");
    ok(await count(page, ".m-sheet .m-skel-card") >= 2, "骨架形状接近真实卡片");
    await page.waitForSelector(".m-mem > li", { timeout: 10000 });
    ok(await count(page, ".m-sheet .m-skel") === 0, "读完后骨架直接换成内容");
    const delays: number[] = await page.evaluate(() => Array.from(document.querySelectorAll(".m-mem > li")).map((li) => {
      const a = li.getAnimations()[0];
      return a ? Number(a.effect?.getTiming().delay ?? 0) : -1;
    }));
    ok(delays.length === 4 && delays.every((d) => d >= 0), `首屏 4 条记忆都有入场（${delays.join(",")}）`);
    ok(delays.every((d, i) => i === 0 || d > delays[i - 1]) && delays[3] <= 200, `入场轻错峰、总延迟克制（${delays.join("ms, ")}ms）`);
    ok(memoryGets === 1, `打开面板只读取一次（实际 ${memoryGets} 次）`);
    await page.unroute("**/api/memory");
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, "desktop-memory-list.png") });

    // 置顶最后一条：它滑到顶部（transform），其它项让位
    const texts = async () => page.evaluate(() => Array.from(document.querySelectorAll(".m-mem > li")).map((li) => (li.textContent || "").slice(0, 8)));
    const before = await texts();
    const last = page.locator(".m-mem > li").last();
    await last.locator("button", { hasText: "置顶" }).click();
    await page.waitForFunction(() => /P1 记忆 4/.test(document.querySelector(".m-mem > li")?.textContent || ""), null, { timeout: 8000 });
    const moving = await page.evaluate(() => {
      const first = document.querySelector(".m-mem > li")!;
      return first.getAnimations().map((a) => String((a.effect as KeyframeEffect).getKeyframes()[0]?.transform || "")).join("|");
    });
    ok(/translateY/.test(moving), `被置顶项从原位置滑到顶部（${moving || "无动画"}）`);
    ok((await texts()).length === before.length, "置顶后条数不变");
    await sleep(700);

    // 删除最后一条：上面的项都不动（只动变化项）
    const lastBefore = await page.locator(".m-mem > li").last().textContent();
    await page.locator(".m-mem > li").last().locator("button", { hasText: "忘掉" }).click();
    const confirmBtn = page.locator(".m-mem > li").last().locator("button", { hasText: /确认/ });
    if (await confirmBtn.count()) await confirmBtn.first().click();
    await page.waitForFunction((t: string) => Array.from(document.querySelectorAll(".m-mem > li")).every((li) => li.textContent !== t), lastBefore, { timeout: 8000 });
    const animatedAfterDelete = await page.evaluate(() => Array.from(document.querySelectorAll(".m-mem > li")).filter((li) => li.getAnimations().length > 0).length);
    ok(animatedAfterDelete === 0, `删除最后一项时其它项不动（在动 ${animatedAfterDelete} 项）`);
    await page.click('.m-sheet-head button[aria-label="关闭"]');
    await sleep(400);

    section("凭证面板：骨架同样只在读取时出现");
    await page.route("**/api/vault**", async (route: any) => { if (route.request().method() === "GET") await sleep(700); return route.continue(); });
    await page.click('.m-top-acts button[aria-label="凭证"]');
    await page.waitForSelector(".m-sheet", { state: "visible" });
    await sleep(120);
    ok(await count(page, ".m-sheet .m-skel") === 1, "凭证面板读取中显示骨架");
    await page.waitForFunction(() => !document.querySelector(".m-sheet .m-skel"), null, { timeout: 8000 });
    ok(await count(page, ".m-sheet .m-skel") === 0, "凭证读完骨架消失（空态或列表）");
    await page.unroute("**/api/vault**");
    await page.click('.m-sheet-head button[aria-label="关闭"]');
    await sleep(400);

    // ---------------------------------------------------------------- 产品标签
    section("产品详情：标签底板滑动、内容淡入、视野稳定");
    await page.goto(`${BASE}/products/${product.id}`, { waitUntil: "networkidle" });
    const TABS = ".hermes-tabs";
    await page.waitForSelector(`${TABS}[data-ink="ready"]`, { timeout: 10000 });
    ok(Math.abs(await inkX(page, TABS) - await activeTabX(page, TABS)) < 1.5, "首屏底板落在当前标签上（无滑入动画）");
    const tabCount = await count(page, `${TABS} [role="tab"]`);
    ok(tabCount >= 3, `产品页有 ${tabCount} 个标签`);
    const x0 = await inkX(page, TABS);
    await page.locator(`${TABS} [role="tab"]`).nth(2).click();
    await sleep(70);
    const xMid = await inkX(page, TABS);
    const target = await activeTabX(page, TABS);
    ok(xMid > x0 + 1 && xMid < target - 1, `底板平滑移动（起点 ${Math.round(x0)} → 中途 ${Math.round(xMid)} → 终点 ${Math.round(target)}）`);
    ok(await page.evaluate(() => {
      const panel = document.querySelector(".hermes-tabs + div") as HTMLElement | null;
      return !!panel && panel.getAnimations().length > 0;
    }), "内容区短暂淡入");
    await sleep(500);
    ok(Math.abs(await inkX(page, TABS) - await activeTabX(page, TABS)) < 1.5, "底板最终对齐选中标签");
    ok(await page.evaluate(() => getComputedStyle(document.querySelector(".hermes-tabs button.is-active")!).backgroundColor) === "rgba(0, 0, 0, 0)", "有底板时选中按钮本身不再画底色（不叠两层）");

    // 快速连点：最后一次为准，底板不停在中间
    for (let i = 0; i < tabCount; i += 1) await page.locator(`${TABS} [role="tab"]`).nth(i).click({ delay: 0 });
    await sleep(600);
    ok(Math.abs(await inkX(page, TABS) - await activeTabX(page, TABS)) < 1.5, "快速连点标签后底板停在最后一次选中的标签上");

    // 键盘：方向键切换并聚焦
    await page.locator(`${TABS} [role="tab"]`).first().click();
    await page.keyboard.press("ArrowRight");
    ok(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute("aria-selected") === "true" && document.activeElement !== document.querySelector(".hermes-tabs [role=tab]")), "→ 键切换到下一个标签并聚焦");
    await page.keyboard.press("End");
    ok(await page.evaluate(() => { const tabs = Array.from(document.querySelectorAll(".hermes-tabs [role=tab]")); return tabs[tabs.length - 1] === document.activeElement && tabs[tabs.length - 1].getAttribute("aria-selected") === "true"; }), "End 键跳到最后一个标签");
    await page.keyboard.press("Home");

    // 视野：滚到标签栏下方再切换，标签栏回到视野顶部附近，不跳到页底 / 页顶
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(100);
    const scrolledEnough = await page.evaluate(() => (document.querySelector(".hermes-tabs") as HTMLElement).getBoundingClientRect().top < 0);
    if (scrolledEnough) {
      await page.evaluate(() => (document.querySelector(".hermes-tabs [role=tab][aria-selected=true]") as HTMLElement).focus({ preventScroll: true }));
      await page.keyboard.press("ArrowRight");
      await sleep(450);
      const top = await page.evaluate(() => (document.querySelector(".hermes-tabs") as HTMLElement).getBoundingClientRect().top);
      ok(top >= 40 && top <= 140, `在下方切换标签后，标签栏回到顶栏下方（top=${Math.round(top)}）`);
    } else ok(true, "页面不够长，无需校验切换后视野（跳过）");
    await page.screenshot({ path: path.join(SHOTS, "desktop-product-tabs.png") });

    // ---------------------------------------------------------------- 提示
    section("页面内提示：失败常驻可关，成功自动淡出");
    await page.locator(`${TABS} [role="tab"]`).first().click();
    await page.evaluate(() => window.scrollTo(0, 0));
    let analysisPosts = 0;
    let analysisStatus = 500;
    await page.route(`**/api/products/${product.id}/analyses`, async (route: any) => {
      if (route.request().method() !== "POST") return route.continue();
      analysisPosts += 1;
      await sleep(400);
      return route.fulfill({ status: analysisStatus, contentType: "application/json", body: JSON.stringify(analysisStatus === 200 ? { ok: true } : { message: "模拟失败：分析服务不可用" }) });
    });
    const runBtn = page.getByRole("button", { name: /运行首次分析|重新分析/ }).first();
    await runBtn.dblclick();
    const danger = page.locator(".hermes-notice.is-danger");
    await danger.waitFor({ timeout: 8000 });
    ok(analysisPosts === 1, `双击只发一次请求（实际 ${analysisPosts} 次）`);
    ok(await danger.getAttribute("role") === "alert", "失败提示 role=alert（读屏立即播报）");
    ok((await danger.textContent())?.includes("模拟失败") ?? false, "失败提示保留接口给出的原因");
    await sleep(6000);
    ok(await danger.count() === 1, "失败提示 6 秒后仍在（常驻）");
    await danger.locator(".hermes-notice-close").click();
    ok(await count(page, ".hermes-notice[data-closing]") <= 1, "关闭时先淡出");
    await sleep(350);
    ok(await count(page, ".hermes-notice") === 0, "失败提示可手动关闭");

    analysisStatus = 200;
    await runBtn.click();
    const success = page.locator(".hermes-notice.is-ok");
    await success.waitFor({ timeout: 8000 });
    ok(await success.getAttribute("role") === "status", "成功提示 role=status（礼貌播报）");
    await success.hover();
    await sleep(6000);
    ok(await success.count() === 1, "鼠标停在成功提示上时不自动消失");
    await page.mouse.move(5, 890);
    await sleep(5800);
    ok(await count(page, ".hermes-notice") === 0, "移开后成功提示自动淡出");
    await page.unroute(`**/api/products/${product.id}/analyses`);

    // ---------------------------------------------------------------- 项目标签
    section("项目详情：工作区标签底板");
    await page.goto(`${BASE}/projects/${project.id}`, { waitUntil: "networkidle" });
    const WS = ".hermes-workspace-tabs";
    await page.waitForSelector(`${WS}[data-ink="ready"]`, { timeout: 10000 });
    ok(Math.abs(await inkX(page, WS) - await activeTabX(page, WS)) < 1.5, "项目工作区首屏底板落在「概览」");
    await page.locator(`${WS} [role="tab"]`, { hasText: "工作项" }).click();
    await sleep(60);
    ok((await animCount(page, "#project-workspace-panel")) > 0, "切到「工作项」时内容区淡入");
    await sleep(500);
    ok(Math.abs(await inkX(page, WS) - await activeTabX(page, WS)) < 1.5, "底板滑到「工作项」");
    ok(await page.evaluate(() => getComputedStyle(document.querySelector(".hermes-workspace-tab.is-active")!).backgroundColor) === "rgba(0, 0, 0, 0)", "选中项不叠底色");
    await page.screenshot({ path: path.join(SHOTS, "desktop-project-tabs.png") });

    // ---------------------------------------------------------------- 抽屉
    section("设置页抽屉：退出过渡、焦点恢复、退出途中重开");
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    const manage = page.getByRole("button", { name: /管理/ }).first();
    await manage.click();
    await page.waitForSelector(".kx-drawer-pn", { state: "visible" });
    const title = await page.locator(".kx-drawer-h [id]").first().textContent();
    await sleep(350);
    await page.keyboard.press("Escape");
    await sleep(40);
    ok(await count(page, ".kx-drawer[data-closing]") === 1, "Esc 后抽屉进入退出过渡（data-closing）");
    ok((await page.locator(".kx-drawer-h [id]").first().textContent()) === title, "退出过程中标题和内容保持，不先变空");
    ok(await page.evaluate(() => getComputedStyle(document.querySelector(".kx-drawer")!).pointerEvents) === "none", "退出中的遮罩不拦截点击");
    await sleep(400);
    ok(await count(page, ".kx-drawer") === 0, "退出结束后抽屉卸载、无残留遮罩");
    ok(await page.evaluate(() => /管理/.test(document.activeElement?.textContent || "")), "焦点回到「管理」按钮");
    ok(await page.evaluate(() => getComputedStyle(document.body).overflow) !== "hidden", "滚动锁已释放");

    await manage.click();
    await page.waitForSelector(".kx-drawer-pn", { state: "visible" });
    await sleep(350);
    await page.locator(".kx-drawer-close").first().click();
    await sleep(60);
    await manage.click(); // 退出途中重开：遮罩不拦截，点到下面的「管理」
    await sleep(500);
    ok(await count(page, ".kx-drawer:not([data-closing])") === 1, "退出途中重开：抽屉保持打开，不被旧的退出误关");
    ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector(".kx-drawer-pn")!).opacity)) > 0.99, "重开后面板完全可见（无半透明残留）");
    await page.keyboard.press("Escape");
    await sleep(400);

    // ---------------------------------------------------------------- 手机
    for (const width of [390, 320]) {
      section(`手机 ${width}px：标签与提示不溢出`);
      const mctx = await browser.newContext({ viewport: { width, height: 780 }, reducedMotion: "no-preference", isMobile: true, hasTouch: true });
      const mp = await mctx.newPage();
      watch(mp, `m${width}`);
      await login(mp, user.email);
      await mp.goto(`${BASE}/products/${product.id}`, { waitUntil: "networkidle" });
      await mp.waitForSelector(`${TABS}[data-ink]`, { timeout: 10000 });
      ok((await overflowX(mp)) <= 1, `产品页无横向溢出（${await overflowX(mp)}px）`);
      await mp.locator(`${TABS} [role="tab"]`).last().tap();
      await sleep(500);
      const fit = await mp.evaluate(() => {
        const list = document.querySelector(".hermes-tabs") as HTMLElement;
        const tab = list.querySelector("[role=tab][aria-selected=true]") as HTMLElement;
        const cs = getComputedStyle(list, "::before");
        const m = new DOMMatrixReadOnly(cs.transform);
        return Math.abs(m.m41 - tab.offsetLeft) < 1.5 && Math.abs(m.m42 - tab.offsetTop) < 1.5 && Math.abs(parseFloat(cs.width) - tab.offsetWidth) < 1.5;
      });
      ok(fit, "标签换行时底板仍贴合选中项（横纵坐标与宽度）");
      await mp.goto(`${BASE}/projects/${project.id}`, { waitUntil: "networkidle" });
      await mp.waitForSelector(`${WS}[data-ink]`, { timeout: 10000 });
      await mp.locator(`${WS} [role="tab"]`).last().tap();
      await sleep(500);
      ok(Math.abs(await inkX(mp, WS) - await activeTabX(mp, WS)) < 1.5, "项目工作区（横向滚动标签）底板跟随选中项");
      ok((await overflowX(mp)) <= 1, `项目页无横向溢出（${await overflowX(mp)}px）`);
      await mp.screenshot({ path: path.join(SHOTS, `mobile-${width}-project-tabs.png`) });
      await mctx.close();
    }

    // ---------------------------------------------------------------- 减少动态效果
    section("减少动态效果：立即切换，信息完整");
    const rctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
    const rp = await rctx.newPage();
    watch(rp, "reduce");
    await login(rp, user.email);
    await rp.goto(`${BASE}/products/${product.id}`, { waitUntil: "networkidle" });
    await rp.waitForSelector(`${TABS}[data-ink]`, { timeout: 10000 });
    await rp.locator(`${TABS} [role="tab"]`).nth(1).click();
    await sleep(40);
    ok(Math.abs(await inkX(rp, TABS) - await activeTabX(rp, TABS)) < 1.5, "底板立即到位（无滑动）");
    ok(await rp.evaluate(() => Array.from(document.querySelectorAll("main *")).every((el) => el.getAnimations().every((a) => a.playState !== "running" || Number(a.effect?.getTiming().duration) < 1))), "切换标签不播放内容淡入");
    await rp.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await rp.getByRole("button", { name: /管理/ }).first().click();
    await rp.waitForSelector(".kx-drawer-pn", { state: "visible" });
    await rp.keyboard.press("Escape");
    await sleep(40);
    ok(await count(rp, ".kx-drawer") === 0, "抽屉立即关闭，不等退出动画");
    await rp.goto(`${BASE}/muse?c=${conversation.id}`, { waitUntil: "networkidle" });
    await rp.click('.m-top-acts button[aria-label="记忆"]');
    await rp.waitForSelector(".m-mem > li", { timeout: 10000 });
    ok(await rp.evaluate(() => Array.from(document.querySelectorAll(".m-mem > li")).every((li) => li.getAnimations().length === 0)), "记忆列表直接出现，不错峰");
    await rctx.close();

    section("控制台");
    ok(consoleErrors.length === 0, `全程无控制台错误（${consoleErrors.length} 条${consoleErrors.length ? "：" + consoleErrors.slice(0, 5).join(" | ") : ""}）`);
  } finally {
    await browser.close();
    // ---------- 清理：仅本套夹具 ----------
    await prisma.conversation.deleteMany({ where: { organizationId: org.id } });
    await prisma.kernMemory.deleteMany({ where: { organizationId: org.id } });
    await prisma.workItem.deleteMany({ where: { projectId: project.id } });
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
    await prisma.productVersion.deleteMany({ where: { productId: product.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: user.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  }
  return finish();
}

function finish() {
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) console.log(`🏆 动效 P1 回归：${passed} 项断言全部通过`);
  else {
    console.log(`❌ 动效 P1 回归：${failures.length} 项未通过（通过 ${passed} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");
}

main()
  .then(() => { if (failures.length > 0) process.exitCode = 1; })
  .catch((error) => { console.error("\n❌ 动效 P1 回归中止:", error?.message || error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
