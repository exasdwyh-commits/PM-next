/**
 * 动效 P0 回归（KX-27）：对话页顶部工具面板 / 展开收起 / 按钮状态 / 新消息入口 / 手机端 / 减少动态效果。
 *
 * 运行：npm run test:ui-motion（scripts/acc-server.sh 起生产构建 + 测试库；夹具自建自清理，只清本套 RUN_TAG）。
 * 截图写到 outputs/ui-motion-p0/（不入库），供人工复核视觉。
 *
 * 覆盖需求「关键交互要求」：
 *  1 面板快速开关 / 连续切换不闪屏、不残留遮罩、不误关新面板；
 *  2 长内容展开后保持阅读位置；
 *  3 列表刷新不重播入场；
 *  4 读历史时新回复不强制滚到底，有「有新消息」入口；
 *  5 成功效果在接口确认后才出现，失败保留输入与错误；
 *  7 键盘 Esc / 焦点恢复正常；减少动态效果时功能与状态信息完整。
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
const RUN_TAG = `uimo${Date.now()}`;
const PASSWORD = `UiMo-${crypto.randomBytes(6).toString("hex")}!`;
const SHOTS = path.join(process.cwd(), "outputs", "ui-motion-p0");
const LONG_MEMORY = `动效回归长记忆：${"这是一段很长的偏好说明，用来验证展开全文和收起时的高度过渡与阅读位置。".repeat(8)}`;

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

async function openTool(page: any, label: string) {
  await page.click(`.m-top-acts button[aria-label="${label}"]`);
  await page.waitForSelector(".m-sheet", { state: "visible", timeout: 10000 });
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  fs.mkdirSync(SHOTS, { recursive: true });
  const healthOk = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  ok(healthOk, `运行前探活 ${BASE}/api/health`);
  if (!healthOk) return finish();

  // ---------- 夹具 ----------
  const org = await prisma.organization.create({ data: { code: `${RUN_TAG}_ORG`, name: "动效回归机构（合成夹具）" } });
  const user = await prisma.user.create({
    data: {
      email: `${RUN_TAG}@hermes.test`, name: "动效回归", organizationId: org.id, passwordHash: hashPassword(PASSWORD),
      orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } },
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: org.id, ownerId: user.id, title: `${RUN_TAG} 长对话`,
      messages: {
        create: Array.from({ length: 24 }, (_, i) => ({
          role: i % 2 ? ("ASSISTANT" as const) : ("USER" as const),
          content: `第 ${i + 1} 条：${"用于验证滚动与新消息入口的历史内容。".repeat(5)}`,
          createdAt: new Date(Date.now() - (60 - i) * 60_000),
        })),
      },
    },
  });
  await prisma.kernMemory.createMany({
    data: [
      { organizationId: org.id, userId: user.id, kind: "PREFERENCE", content: LONG_MEMORY },
      { organizationId: org.id, userId: user.id, kind: "PREFERENCE", content: "动效回归短记忆：预算上限 5 万" },
    ],
  });

  const executablePath = findChrome();
  if (!executablePath) throw new Error("未找到 chromium 可执行文件（可设置 CHROME_PATH）");
  console.log(`  · 浏览器：${executablePath}`);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"] });
  const consoleErrors: string[] = [];
  const watch = (page: any, tag: string) => {
    page.on("console", (m: any) => {
      if (m.type() !== "error") return;
      // 「接口失败」用例故意让 POST /api/memory 返回 500，浏览器会记一条资源加载错误；只豁免这一条。
      const where = String(m.location?.()?.url || "");
      if (/status of 500/.test(m.text()) && /\/api\/memory$/.test(where)) return;
      consoleErrors.push(`[${tag}] ${m.text().slice(0, 200)} ${where}`.trim());
    });
    page.on("pageerror", (e: any) => consoleErrors.push(`[${tag}] pageerror ${String(e?.message || e).slice(0, 200)}`));
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    watch(page, "desktop");

    section("登录并打开长对话");
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u: URL) => !u.toString().includes("/login"), { timeout: 20000 });
    await page.goto(`${BASE}/muse?c=${conversation.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".m-turn", { timeout: 15000 });
    const turnAnims = await page.evaluate(() => Array.from(document.querySelectorAll(".m-turn")).reduce((n, el) => n + el.getAnimations().length, 0));
    ok(turnAnims === 0, `历史消息首屏不播放入场动画（实际 ${turnAnims} 个）`);
    const atBottom = await page.evaluate(() => { const b = document.querySelector(".m-scroll")!; return b.scrollHeight - b.scrollTop - b.clientHeight < 140; });
    ok(atBottom, "打开对话直接定位到最新消息");
    await page.screenshot({ path: path.join(SHOTS, "desktop-conversation.png") });

    section("P0 面板：打开 / 关闭 / Esc / 打开中途关闭 / 连续切换");
    await openTool(page, "记忆");
    ok(await page.getAttribute('.m-top-acts button[aria-label="记忆"]', "aria-expanded") === "true", "工具栏按钮在面板打开时 aria-expanded=true");
    ok((await animCount(page, ".m-sheet")) > 0, "面板进入有动画（从右侧轻移淡入）");
    await sleep(450);
    await page.screenshot({ path: path.join(SHOTS, "desktop-memory-sheet.png") });
    await page.click('.m-sheet-head button[aria-label="关闭"]');
    ok(await count(page, ".m-sheet[data-closing]") === 1, "点关闭后面板先进入退出过渡（data-closing）");
    ok((await animCount(page, ".m-sheet")) > 0 && (await animCount(page, ".m-scrim")) > 0, "面板与遮罩同步播放退出动画");
    await sleep(400);
    ok(await count(page, ".m-sheet") === 0 && await count(page, ".m-scrim") === 0, "退出结束后面板与遮罩都已卸载，无残留");
    ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "记忆", "关闭后焦点回到触发按钮");

    await openTool(page, "记忆");
    await sleep(350);
    await page.keyboard.press("Escape");
    ok(await count(page, ".m-sheet[data-closing]") === 1, "Esc 关闭同样走退出过渡");
    await sleep(400);
    ok(await count(page, ".m-sheet") === 0, "Esc 关闭后面板卸载");

    await openTool(page, "记忆");
    await sleep(60);
    await page.keyboard.press("Escape");
    await sleep(420);
    ok(await count(page, ".m-sheet") === 0 && await count(page, ".m-scrim") === 0, "打开动画进行到一半就关闭：干净退出、无残留遮罩");

    await openTool(page, "记忆");
    await sleep(120);
    await page.click('.m-sheet-head button[aria-label="关闭"]');
    await page.click('.m-top-acts button[aria-label="凭证"]'); // 遮罩退出期间点击会被挡住，Playwright 等它可点后再点
    await page.waitForSelector('.m-sheet[data-utility="vault"]', { timeout: 10000 });
    await sleep(600);
    ok(await count(page, '.m-sheet[data-utility="vault"]:not([data-closing])') === 1, "关闭后立刻打开另一面板：新面板保持打开，未被旧面板的退出回调误关");
    ok(await count(page, ".m-scrim") === 1, "同一时间只有一层遮罩");

    { const sh = await shifted(page); ok(sh.length === 0, `上一段操作后布局没有被横向挤动（${sh.join(" ; ") || "无"}）`); }
    section("P0 展开收起：新增表单（details）");
    const details = '.m-sheet details.m-sheet-compose';
    const closedH = await page.evaluate((s: string) => document.querySelector(s)!.getBoundingClientRect().height, details);
    await page.click(`${details} > summary`);
    await sleep(70);
    const midH = await page.evaluate((s: string) => document.querySelector(s)!.getBoundingClientRect().height, details);
    await sleep(420);
    const openH = await page.evaluate((s: string) => document.querySelector(s)!.getBoundingClientRect().height, details);
    ok(await page.evaluate((s: string) => (document.querySelector(s) as HTMLDetailsElement).open, details), "点击后表单展开");
    ok(midH > closedH + 1 && midH < openH - 1, `展开过程中高度平滑过渡（${Math.round(closedH)} → ${Math.round(midH)} → ${Math.round(openH)}）`);
    await page.screenshot({ path: path.join(SHOTS, "desktop-vault-compose-open.png") });
    await page.click(`${details} > summary`);
    await sleep(60);
    ok(await count(page, `${details}[open][data-closing]`) === 1, "收起过程中保持 open 并标记 data-closing（箭头提前转回）");
    await sleep(420);
    ok(!(await page.evaluate((s: string) => (document.querySelector(s) as HTMLDetailsElement).open, details)), "收起结束后 details 关闭");
    await page.click(`${details} > summary`);
    await sleep(50);
    await page.click(`${details} > summary`);
    await sleep(450);
    const settled = await page.evaluate((s: string) => { const d = document.querySelector(s) as HTMLDetailsElement; return { open: d.open, closing: d.dataset.closing ?? null, anims: d.getAnimations().length }; }, details);
    ok(!settled.open && settled.closing === null && settled.anims === 0, `连续快速点两次：最终收起且无卡住状态（${JSON.stringify(settled)}）`);
    await page.keyboard.press("Escape");
    await sleep(400);

    { const sh = await shifted(page); ok(sh.length === 0, `上一段操作后布局没有被横向挤动（${sh.join(" ; ") || "无"}）`); }
    section("P0 展开全文：高度过渡、后续卡片移位");
    await openTool(page, "记忆");
    await page.waitForSelector(".m-sheet .m-sheet-more", { timeout: 10000 });
    const more = page.locator(".m-sheet .m-sheet-more").first();
    const nextTop0 = await page.evaluate(() => { const li = document.querySelectorAll(".m-sheet .m-mem > li")[1]; return li ? li.getBoundingClientRect().top : null; });
    await more.click();
    await sleep(60);
    const boxAnims = await page.evaluate(() => { const b = document.querySelector(".m-sheet .m-sheet-text > div"); return b ? b.getAnimations().length : -1; });
    ok(boxAnims > 0, "展开全文时文本区有高度过渡");
    await sleep(450);
    ok((await more.getAttribute("aria-expanded")) === "true" && (await more.textContent())?.includes("收起"), "展开后按钮变为「收起」且 aria-expanded=true");
    const nextTop1 = await page.evaluate(() => { const li = document.querySelectorAll(".m-sheet .m-mem > li")[1]; return li ? li.getBoundingClientRect().top : null; });
    ok(nextTop0 !== null && nextTop1 !== null && nextTop1 > nextTop0 + 10, "后续卡片随展开自然下移");
    await page.evaluate(() => { const b = document.querySelector(".m-sheet .m-sheet-body")!; b.scrollTop = b.scrollHeight; });
    await more.click();
    await sleep(450);
    const inView = await page.evaluate(() => {
      const btn = document.querySelector(".m-sheet .m-sheet-more")!.getBoundingClientRect();
      const body = document.querySelector(".m-sheet .m-sheet-body")!.getBoundingClientRect();
      return btn.top >= body.top - 1 && btn.bottom <= body.bottom + 1;
    });
    ok(inView, "收起后「展开全文」按钮仍在可视区内，阅读位置不丢");

    { const sh = await shifted(page); ok(sh.length === 0, `上一段操作后布局没有被横向挤动（${sh.join(" ; ") || "无"}）`); }
    section("P0 按钮：提交中 → 成功（接口确认后）/ 失败保留输入；不重复请求");
    let memoryPosts = 0;
    let mode: "slow" | "fail" = "slow";
    await page.route("**/api/memory", async (route: any) => {
      if (route.request().method() !== "POST") return route.continue();
      memoryPosts += 1;
      if (mode === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "模拟保存失败" }) });
      await sleep(700);
      return route.continue();
    });
    const submit = '.m-sheet .m-mem-add button[type="submit"]';
    await page.fill("#m-memory-draft", "动效回归：新增记忆");
    await page.click(submit);
    await sleep(120);
    ok(await page.getAttribute(submit, "data-state") === "busy" && await page.getAttribute(submit, "aria-busy") === "true", "提交中：按钮 data-state=busy、aria-busy");
    ok(await page.isDisabled(submit), "提交中按钮禁用，防止重复提交");
    await page.click(submit, { force: true, timeout: 1000 }).catch(() => {});
    await page.waitForSelector(`${submit}[data-state="done"]`, { timeout: 8000 });
    ok(true, "接口返回后按钮才进入成功态 data-state=done");
    ok(memoryPosts === 1, `提交中重复点击不产生第二个请求（POST 次数 ${memoryPosts}）`);
    ok(await page.locator(".m-sheet .m-mem > li", { hasText: "动效回归：新增记忆" }).count() === 1, "新记忆出现在列表中");
    await page.screenshot({ path: path.join(SHOTS, "desktop-memory-saved.png") });
    await sleep(1800);
    ok(await page.getAttribute(submit, "data-state") === null, "成功态自动回到空闲");
    mode = "fail";
    await page.fill("#m-memory-draft", "动效回归：失败时保留");
    await page.click(submit);
    await page.waitForSelector(`${submit}[data-state="error"]`, { timeout: 8000 });
    ok(true, "接口失败：按钮进入失败态 data-state=error");
    ok(await page.inputValue("#m-memory-draft") === "动效回归：失败时保留", "失败后保留用户输入");
    ok((await page.locator('.m-sheet [role="alert"]').textContent())?.includes("模拟保存失败") ?? false, "失败原因以 role=alert 持续显示");
    await page.unroute("**/api/memory");

    await page.route("**/api/memory/*", async (route: any) => {
      if (route.request().method() === "PATCH") await sleep(600);
      return route.continue();
    });
    const pinBtn = page.locator(".m-sheet .m-mem > li", { hasText: "动效回归短记忆" }).locator("button", { hasText: "置顶" });
    await pinBtn.click();
    await sleep(100);
    ok(await pinBtn.getAttribute("data-state") === "busy", "行内「置顶」按钮显示处理中");
    await page.waitForSelector('.m-sheet .m-mem-acts button[data-state="done"]', { timeout: 8000 });
    ok(await page.locator('.m-sheet .m-mem-acts button[data-state="done"]').textContent() === "取消置顶", "置顶成功后按钮短暂显示成功态并更新文案");
    await page.unroute("**/api/memory/*");
    await page.keyboard.press("Escape");
    await sleep(400);

    { const sh = await shifted(page); ok(sh.length === 0, `上一段操作后布局没有被横向挤动（${sh.join(" ; ") || "无"}）`); }
    section("P0 对话：读历史时新回复不强制滚动，提供「有新消息」入口");
    await page.evaluate(() => { const b = document.querySelector(".m-scroll") as HTMLElement; b.style.scrollBehavior = "auto"; b.scrollTop = 0; b.dispatchEvent(new Event("scroll")); });
    await sleep(300);
    await prisma.message.create({ data: { conversationId: conversation.id, role: "ASSISTANT", content: `${RUN_TAG} 这是一条新到的回复。` } });
    await page.waitForSelector(".m-jump", { timeout: 12000 });
    const top = await page.evaluate(() => document.querySelector(".m-scroll")!.scrollTop);
    ok(top < 60, `新回复到达时保持阅读位置（scrollTop=${top}）`);
    await page.screenshot({ path: path.join(SHOTS, "desktop-new-message-pill.png") });
    await page.evaluate(() => { (document.querySelector(".m-scroll") as HTMLElement).style.scrollBehavior = ""; });
    await page.click(".m-jump");
    let jump = { gap: -1, pill: -1 };
    for (let i = 0; i < 20; i += 1) {
      await sleep(150);
      jump = { gap: Math.round(await page.evaluate(() => { const b = document.querySelector(".m-scroll")!; return b.scrollHeight - b.scrollTop - b.clientHeight; })), pill: await count(page, ".m-jump") };
      if (jump.gap < 140 && jump.pill === 0) break;
    }
    ok(jump.gap < 140 && jump.pill === 0, `点「有新消息」滚到最新并收起入口（${JSON.stringify(jump)}）`);
    await sleep(3000);
    const replay = await page.evaluate(() => Array.from(document.querySelectorAll(".m-turn")).reduce((n, el) => n + el.getAnimations().length, 0));
    ok(replay === 0, `轮询刷新后不重播任何消息的入场动画（实际 ${replay}）`);

    const state = await context.storageState();

    { const sh = await shifted(page); ok(sh.length === 0, `上一段操作后布局没有被横向挤动（${sh.join(" ; ") || "无"}）`); }
    section("手机端 390 / 320：底部进入、无溢出");
    for (const width of [390, 320]) {
      const mctx = await browser.newContext({ viewport: { width, height: 760 }, reducedMotion: "no-preference", storageState: state, hasTouch: true });
      const mp = await mctx.newPage();
      watch(mp, `m${width}`);
      await mp.goto(`${BASE}/muse?c=${conversation.id}`, { waitUntil: "networkidle" });
      await mp.waitForSelector(".m-turn", { timeout: 15000 });
      ok(await mp.evaluate(() => document.documentElement.scrollWidth) <= width, `${width}px：页面无横向溢出`);
      await mp.click('.m-top-acts button[aria-label="记忆"]');
      await mp.waitForSelector(".m-sheet", { state: "visible" });
      await sleep(40);
      const ty = await mp.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".m-sheet")!).transform).m42);
      ok(ty > 0, `${width}px：面板从底部进入（进入途中 translateY=${ty.toFixed(1)}px）`);
      await sleep(450);
      const box = await mp.evaluate(() => { const r = document.querySelector(".m-sheet")!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
      ok(box.l >= 0 && box.r <= width && box.t >= 0 && box.b <= 760, `${width}px：面板完整落在视口内（${JSON.stringify(box)}）`);
      await mp.screenshot({ path: path.join(SHOTS, `mobile-${width}-memory-sheet.png`) });
      await mp.click('.m-sheet-head button[aria-label="关闭"]');
      await sleep(30);
      const ty2 = await mp.evaluate(() => { const s = document.querySelector(".m-sheet"); return s ? new DOMMatrixReadOnly(getComputedStyle(s).transform).m42 : -1; });
      ok(ty2 > 0, `${width}px：关闭时向下退出（translateY=${ty2.toFixed(1)}px）`);
      await sleep(400);
      ok(await count(mp, ".m-sheet") === 0, `${width}px：关闭后卸载`);
      await mctx.close();
    }

    section("减少动态效果：静态反馈、功能完整；设置页可覆盖为「始终播放」");
    const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", storageState: state });
    const rp = await rctx.newPage();
    watch(rp, "reduce");
    await rp.goto(`${BASE}/muse?c=${conversation.id}`, { waitUntil: "networkidle" });
    await rp.waitForSelector(".m-turn");
    await rp.click('.m-top-acts button[aria-label="凭证"]');
    await rp.waitForSelector(".m-sheet");
    await rp.click('.m-sheet details.m-sheet-compose > summary');
    ok(await rp.evaluate(() => (document.querySelector(".m-sheet details.m-sheet-compose") as HTMLDetailsElement).open), "减少动态效果：表单立即展开（原生开合）");
    await rp.click('.m-sheet-head button[aria-label="关闭"]');
    await sleep(30);
    ok(await count(rp, ".m-sheet") === 0 && await count(rp, ".m-scrim") === 0, "减少动态效果：关闭立即生效，不等动画");
    await rp.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    const motionCard = rp.locator("#kx-st-motion");
    ok(await motionCard.count() === 1, "设置页有「界面动效」卡片");
    ok((await rp.locator('section[aria-labelledby="kx-st-motion"] [role="status"]').textContent())?.includes("减少动态效果") ?? false, "设置页说明系统已开启减少动态效果");
    await rp.check('input[name="kern-motion"][value="full"]');
    ok(await rp.evaluate(() => document.documentElement.dataset.motion) === "full", "选「始终播放」后立即写入 html[data-motion=full]");
    await rp.screenshot({ path: path.join(SHOTS, "settings-motion-preference.png"), fullPage: true });
    await rp.goto(`${BASE}/muse?c=${conversation.id}`, { waitUntil: "networkidle" });
    ok(await rp.evaluate(() => document.documentElement.dataset.motion) === "full", "刷新后偏好在首帧前生效");
    await rp.click('.m-top-acts button[aria-label="记忆"]');
    await rp.waitForSelector(".m-sheet");
    ok((await animCount(rp, ".m-sheet")) > 0, "覆盖后即使系统要求减少动态效果，面板仍播放进入动画");
    await sleep(400);
    await rp.click('.m-sheet-head button[aria-label="关闭"]');
    ok(await count(rp, ".m-sheet[data-closing]") === 1, "覆盖后关闭同样有退出过渡");
    await sleep(400);
    await rp.evaluate(() => localStorage.removeItem("kern-motion"));
    await rctx.close();

    section("控制台");
    ok(consoleErrors.length === 0, `全程无控制台错误（${consoleErrors.length} 条${consoleErrors.length ? "：" + consoleErrors.slice(0, 5).join(" | ") : ""}）`);
  } finally {
    await browser.close();
    // ---------- 清理：仅本套夹具（记忆、会话随用户 / 会话级联） ----------
    await prisma.conversation.deleteMany({ where: { organizationId: org.id } });
    await prisma.kernMemory.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: user.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  }
  return finish();
}

function finish() {
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) console.log(`🏆 动效 P0 回归：${passed} 项断言全部通过`);
  else {
    console.log(`❌ 动效 P0 回归：${failures.length} 项未通过（通过 ${passed} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");
}

main()
  .then(() => { if (failures.length > 0) process.exitCode = 1; })
  .catch((error) => { console.error("\n❌ 动效 P0 回归中止:", error?.message || error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
