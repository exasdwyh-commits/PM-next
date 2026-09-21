/**
 * 交互反馈层回归锁（QA 独立验证 · 2026-09-16）
 *
 * 背景：`8dddedc` / `5160814` / `d6d5583` 三笔提交引入的「等待 / 加载 / 出错 / 找不到 / 理由输入」
 * 交互反馈层，当时只有人工浏览器验证、**没有任何持久断言**。此文件把它固化为可复现断言：
 * 下次谁改坏了，这里会红。
 *
 * 修订（2026-09-17）：team-lead 判定「路线级 loading.tsx」在本项目不成立（会让 notFound() 改不了
 * 404、redirect("/login") 落在 hydrate 之后），两个 loading.tsx 已删除，改为纯客户端 NavProgress。
 * 本文件守卫 2 / 7 随之改瞄新设计（nav-progress.tsx / app-shell.tsx / globals.css），不再引用已删模块。
 *
 * 分两层：
 *   A. 源码级守卫（无需服务，极便宜、极有价值）：原生弹窗 / 整页刷新清零、导航进度条与壳层同构、a11y 属性、
 *      理由对话框文案不与 label 拼接、<Empty> 真空状态未被误改；
 *   B. 运行时（Playwright，真实生产构建）：降动画可读性、思考动画出现与无障碍、404/500 页、
 *      原生弹窗计数恒为 0、理由对话框「取消 = 0 写请求」、局部刷新不清空页面状态。
 *
 * 前置（与 tests/ui-b01-evidence.ts 同一套服务，端口 3111）：
 *   bash scripts/acc-server.sh tests/ui-feedback-layer.ts
 * 或手工：
 *   NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL=<测试库> npx next start -p 3111
 *   UI_BASE_URL=http://127.0.0.1:3111 NODE_OPTIONS= node_modules/.bin/tsx scripts/run-test.ts tests/ui-feedback-layer.ts
 *
 * 夹具自建自清理，只清本套 RUN_TAG 前缀记录；不写任何真实业务数据。
 * 本文件**不使用** `alert(` / `prompt(` / `window.location.reload(`；下面的源码守卫正是断言这一点。
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import { Thinking } from "../src/components/ui";

// ui.tsx 等组件用 Next 的自动 JSX 运行时；tsx(esbuild) 走 classic 运行时，
// 需要把 React 挂到全局，否则未显式 import React 的组件会报 "React is not defined"。
(globalThis as any).React = React;

const { chromium } = require("playwright");

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3111";
const SRC_ROOT = path.join(process.cwd(), "src");
const RUN_TAG = `uifb${Date.now()}`;
const PASSWORD = `UiFb-${crypto.randomBytes(6).toString("hex")}!`;

const HOME = os.homedir();
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  path.join(HOME, "Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p): p is string => !!p);

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

function section(title: string) {
  console.log(`\n▶ ${title}`);
}

// ---------------------------------------------------------------------------
// 源码级工具
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function srcFiles(): string[] {
  return walk(SRC_ROOT).filter((f) => /\.(ts|tsx)$/.test(f));
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

/**
 * 去掉注释后再做「不含 X」这类结构断言。
 * 例：globals.css 的修订注释里会提到「.hermes-skel-* 已删除」，
 * 若按原文匹配会把「注释提及」误判为「结构仍在」。负向断言一律用去注释后的文本。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** 命中计数：返回 { file, line } 列表。匹配前先去掉注释，避免「注释里提到」被当成「代码里用了」。 */
function hits(files: string[], re: RegExp): string[] {
  const found: string[] = [];
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, "utf8"));
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) found.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  return found;
}

/** 从 rgb()/rgba() 字符串解析分量 */
function parseRgb(input: string): { r: number; g: number; b: number; a: number } | null {
  const m = /rgba?\(([^)]+)\)/.exec(input || "");
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** 相对亮度（0=黑，1=白），用于证明「可读」而不是「透明/浅色」 */
function luminance(rgb: { r: number; g: number; b: number }): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------

async function main() {
  await assertTestDatabaseSafety(prisma);

  console.log("================================================================================");
  console.log("🧪 交互反馈层回归锁（QA 独立验证）");
  console.log(`    BASE_URL=${BASE}`);
  console.log("================================================================================");

  // ======================= A. 源码级守卫 =======================
  const files = srcFiles();

  section("源码守卫 1：原生弹窗 / 整页刷新已清零（去注释后匹配）");
  const reloadHits = hits(files, /window\.location\.reload\s*\(/);
  const alertHits = hits(files, /\balert\s*\(/);
  const promptHits = hits(files, /\bprompt\s*\(/);
  const confirmHits = hits(files, /\bconfirm\s*\(/);
  ok(reloadHits.length === 0, `src/ 下 window.location.reload( 命中 0（实际 ${reloadHits.length}）${reloadHits.join(" | ")}`);
  ok(alertHits.length === 0, `src/ 下原生 alert(（含 window.alert）命中 0（实际 ${alertHits.length}）${alertHits.join(" | ")}`);
  ok(promptHits.length === 0, `src/ 下原生 prompt(（含 window.prompt）命中 0（实际 ${promptHits.length}）${promptHits.join(" | ")}`);
  ok(confirmHits.length === 0, `src/ 下原生 confirm( 命中 0（实际 ${confirmHits.length}）${confirmHits.join(" | ")}`);

  section("源码守卫 2：导航进度条与壳层同构（NavProgress 纯客户端 / AppShell 服务端）");
  const navRaw = readSrc("components/nav-progress.tsx");
  const navSrc = stripComments(navRaw);
  const shellRaw = readSrc("components/app-shell.tsx");
  const shellSrc = stripComments(shellRaw);
  const cssSrc = stripComments(readSrc("app/globals.css"));
  ok(navRaw.includes('"use client"'), "nav-progress.tsx 声明 use client（纯客户端观感层）");
  ok(/function getServerSnapshot\(\)\s*:\s*boolean\s*\{\s*return false;/.test(navSrc),
    "NavProgress getServerSnapshot 恒返回 false（杜绝 SSR/水合错配）");
  ok(navSrc.includes("if (href === pathname) return;"), "NavProgressLink 点当前页不点亮（href===pathname 早退）");
  ok(/event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/.test(navSrc),
    "NavProgressLink 忽略修饰键（新标签/新窗口不点亮）");
  ok(navSrc.includes('href.startsWith("http")'), "NavProgressLink 忽略外链（http 早退）");
  ok(!shellRaw.includes('"use client"'), "app-shell.tsx 无 use client（保持服务端组件）");
  ok(/from "\.\/nav-progress"/.test(shellSrc), "app-shell.tsx 从 ./nav-progress 引入（仅引用客户端子组件）");
  ok(shellSrc.includes("<NavProgress />"), "app-shell.tsx 挂载 <NavProgress />（顶栏进度条）");
  ok(shellSrc.includes("<NavProgressLink"), "app-shell.tsx 用 NavProgressLink 渲染导航项");
  ok(!/@keyframes\s+hermes-skel-sweep/.test(cssSrc), "globals.css 无 @keyframes hermes-skel-sweep（旧骨架已删）");
  ok(!/\.hermes-skeleton\b/.test(cssSrc) && !/\.hermes-skel-/.test(cssSrc), "globals.css 无 .hermes-skeleton/.hermes-skel-* 类（旧骨架已删）");
  ok(cssSrc.includes(".hermes-nav-progress {"), "globals.css 定义 .hermes-nav-progress（动画进度条）");
  ok(cssSrc.includes(".hermes-nav-progress-note"), "globals.css 定义 .hermes-nav-progress-note（降动画静态替代）");
  ok(cssSrc.includes(".hermes-sr-only"), "globals.css 定义 .hermes-sr-only（读屏专用）");

  section("源码守卫 2b：路线级 loading.tsx 不得回归（防 P0）");
  // 为什么要有这条断言（注释只是说明，判断依据写在断言文案里，背离时定会红）：
  //   App Router 一旦给某段路由加 loading.tsx，该段改走流式渲染——响应头 200 会先发出，后代组件里的
  //   notFound() 只能改渲染内容、改不了状态码（404 → 200）；redirect("/login") 也会落到 hydrate 之后。
  //   本仓 tests/acceptance-product-center.test.ts 对 projects/[id] 有 404 硬验收（4.18），且大量受保护页
  //   靠 redirect("/login") 跳转。曾因根 src/app/loading.tsx 使 product-center 33→32、ui-b01-evidence 13→11。
  const appRoot = path.join(SRC_ROOT, "app");
  const appLoadingFiles = walk(appRoot)
    .filter((f) => path.basename(f) === "loading.tsx")
    .map((f) => path.relative(process.cwd(), f));
  const loginRedirectCount = files.filter((f) =>
    stripComments(fs.readFileSync(f, "utf8")).includes('redirect("/login")')
  ).length;
  ok(
    appLoadingFiles.length === 0,
    `路线级 loading.tsx 数量为 0（实际 ${appLoadingFiles.length}：${appLoadingFiles.join(", ") || "无"}）—— App Router 流式边界会让后代 notFound() 丢 404 状态码、redirect() 推迟到 hydrate 之后；本仓 projects/[id] 有 404 硬验收，另有 ${loginRedirectCount} 个源文件靠 redirect("/login") 跳转`
  );
  ok(
    !fs.existsSync(path.join(SRC_ROOT, "app/loading.tsx")),
    "历史位点 src/app/loading.tsx 不存在（曾致 product-center 4.18 由 404 变 200）"
  );
  ok(
    !fs.existsSync(path.join(SRC_ROOT, "app/login/loading.tsx")),
    "历史位点 src/app/login/loading.tsx 不存在（曾致退出登录流落不到 /login）"
  );

  section("源码守卫 3：Thinking 原语的无障碍契约");
  const uiSrc = stripComments(readSrc("components/ui.tsx"));
  ok(/role="status"/.test(uiSrc), 'ui.tsx Thinking 含 role="status"');
  ok(/aria-live="polite"/.test(uiSrc), 'ui.tsx Thinking 含 aria-live="polite"');
  ok(/className="hermes-thinking-dots" aria-hidden="true"/.test(uiSrc), "圆点容器 aria-hidden=true");

  section("源码守卫 4：异步横幅带 aria-live（≥3 处）");
  const ariaFiles = files.filter((f) => fs.readFileSync(f, "utf8").includes("aria-live"));
  const ariaCount = ariaFiles.length;
  ok(ariaCount >= 3, `src/ 下带 aria-live 的源文件数 ≥3（实际 ${ariaCount}: ${ariaFiles.map((f) => path.relative(SRC_ROOT, f)).join(", ")}）`);

  section("源码守卫 5：理由对话框说明文案不与 label 拼接");
  const reasonSrc = stripComments(readSrc("components/reason-dialog.tsx"));
  ok(reasonSrc.includes('opts.note ?? "理由为必填，将写入留痕。"'), '存在 opts.note ?? "理由为必填，将写入留痕。"（独立说明）');
  ok(!reasonSrc.includes("{opts.label}为必填"), "不存在 {opts.label}为必填（病句拼接）");

  section("源码守卫 6：<Empty> 真空状态未被误改");
  const revisionSrc = stripComments(readSrc("app/products/[id]/revision-panel.tsx"));
  const launchSrc = stripComments(readSrc("app/products/[id]/launch-tab.tsx"));
  ok(revisionSrc.includes('<Thinking label="正在读取最新分析与版本状态…" />'), "revision-panel 加载分支为 <Thinking>");
  ok(revisionSrc.includes("<Empty>该产品还没有版本，无法生成修改草案。</Empty>"), "revision-panel 真缺口仍为 <Empty>（无版本）");
  ok(revisionSrc.includes("<Empty>{data.note"), "revision-panel 真缺口仍为 <Empty>（无草案）");
  ok(launchSrc.includes('<Thinking label="正在读取上市计划…" />'), "launch-tab 加载分支为 <Thinking>");
  ok(launchSrc.includes("尚未建立上市计划。") && launchSrc.includes("<Empty>还没有里程碑。"), "launch-tab 两处真空状态仍为 <Empty>");

  section("源码守卫 7：确定性渲染（Thinking 原语，无 loading 模块依赖）");
  const thinkingHtml = renderToStaticMarkup(React.createElement(Thinking, { label: "QA 探针" }));
  ok(thinkingHtml.includes('role="status"') && thinkingHtml.includes('aria-live="polite"'), "Thinking 渲染含 role=status + aria-live=polite");
  ok(thinkingHtml.includes('aria-hidden="true"'), "Thinking 渲染圆点容器 aria-hidden=true");
  ok(thinkingHtml.includes("QA 探针"), "Thinking 渲染携带 label 文本");
  // 两次渲染必须逐字节一致（确定性），防止渲染里混入随机 / 时间。
  ok(thinkingHtml === renderToStaticMarkup(React.createElement(Thinking, { label: "QA 探针" })), "Thinking 两次渲染结果逐字节一致（确定性）");

  // ======================= B. 运行时（Playwright） =======================
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  ok(!!chrome, `找到 chromium 可执行文件（${chrome || "未找到：" + CHROME_CANDIDATES.join(" , ")}）`);

  let healthOk = false;
  try {
    const res = await fetch(`${BASE}/api/health`);
    healthOk = res.ok;
  } catch {
    healthOk = false;
  }
  ok(healthOk, `运行前探活 ${BASE}/api/health（${healthOk ? "200" : "不可达 —— 运行时断言无法执行"}）`);

  if (!chrome || !healthOk) {
    // 不能因为服务不可达就把运行时断言静默跳过（那就是"永绿"）。
    failures.push("运行时断言未执行：chromium 或服务不可达");
    return finish();
  }

  // ---------- 夹具 ----------
  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_ORG`, name: "交互反馈层回归机构（合成夹具）" },
  });
  const mkUser = (email: string, name: string, role: "ORG_ADMIN" | "MEMBER") =>
    prisma.user.create({
      data: {
        email,
        name,
        organizationId: org.id,
        passwordHash: hashPassword(PASSWORD),
        orgMemberships: { create: { organizationId: org.id, role } },
      },
    });
  const owner = await mkUser(`${RUN_TAG}-owner@hermes.test`, "回归负责人", "ORG_ADMIN");
  const leader = await mkUser(`${RUN_TAG}-leader@hermes.test`, "回归决策人", "MEMBER");

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      name: "交互反馈层回归产品",
      identityCode: `${RUN_TAG}-PRODUCT`,
      targetAudience: "合成夹具人群",
      marketPath: "私域",
      devMode: "NEW_PRODUCT",
    },
  });
  const productVersion = await prisma.productVersion.create({
    data: {
      productId: product.id,
      versionTag: `${RUN_TAG}-v1`,
      specs: { netWeight: "10g" },
      targetCost: 12,
      currency: "CNY",
      isConfirmed: true,
      isImmutable: true,
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      title: `${RUN_TAG}_回归项目`,
      target: "验证交互反馈层",
      mode: "NEW_PRODUCT",
      stage: "RESEARCH",
      ownerId: owner.id,
      decisionMakerId: leader.id,
      productId: product.id,
      productVersionId: productVersion.id,
      revision: 1,
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: "OWNER" },
      { projectId: project.id, userId: leader.id, role: "DECISION_MAKER" },
    ],
  });

  // 已获准的上市计划：用于 B7「撤销获准」取消安全性
  const plan = await prisma.launchPlan.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      projectId: project.id,
      title: `${RUN_TAG} 上市计划`,
      targetDate: new Date(Date.now() + 86400000 * 30),
      ownerId: owner.id,
      createdById: owner.id,
      status: "ACTIVE",
      approvedAt: new Date(),
    },
  });
  await prisma.launchMilestone.createMany({
    data: [
      { planId: plan.id, organizationId: org.id, title: "素材定稿", kind: "MATERIAL", seq: 0, status: "DONE", completedAt: new Date() },
      { planId: plan.id, organizationId: org.id, title: "渠道上线", kind: "CHANNEL", seq: 1, status: "DONE", completedAt: new Date() },
    ],
  });

  // 待验收工作项（projects / war-room 的 askReason 触发点）
  await prisma.workItem.create({
    data: {
      projectId: project.id,
      title: "QA 待验收成果",
      target: "验证理由对话框",
      deliverableReq: "回归证据",
      status: "SUBMITTED",
      inputRevision: 1,
    },
  });
  // 待处置反馈（consultation / war-room / projects 的 askReason 触发点）
  const feedback = await prisma.feedback.create({
    data: {
      projectId: project.id,
      targetType: "Project",
      targetId: project.id,
      authorId: leader.id,
      content: "QA 初始反馈内容",
      status: "OPEN",
    },
  });

  const browser = await chromium.launch({
    executablePath: chrome,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const nativeDialogs: string[] = [];
    page.on("dialog", (d: any) => {
      nativeDialogs.push(`${d.type()}:${d.message().slice(0, 60)}`);
      d.dismiss().catch(() => {});
    });
    const writes: string[] = [];
    page.on("request", (r: any) => {
      const m = r.method();
      if (["POST", "PUT", "PATCH", "DELETE"].includes(m)) {
        try {
          const u = new URL(r.url());
          if (u.pathname.startsWith("/api/")) writes.push(`${m} ${u.pathname}`);
        } catch {
          /* ignore */
        }
      }
    });

    section("运行时 0：登录");
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', owner.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u: URL) => !u.toString().includes("/login"), { timeout: 20000 });
    await page.waitForTimeout(800);
    ok(!page.url().includes("/login"), `登录成功并离开登录页（${page.url()}）`);
    // 防御性：若存在新手引导弹窗，先关掉
    for (const t of ["完成", "跳过", "开始使用"]) {
      const btn = page.getByRole("button", { name: t, exact: true });
      if (await btn.count()) await btn.first().click().catch(() => {});
    }

    // ---------- B2 + B1：思考动画出现 / 无障碍 / 降动画可读性 ----------
    section("运行时 B2：思考动画真的出现且有正确 a11y");
    await page.goto(`${BASE}/advisor`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    // 放慢服务端应答，让 Thinking 稳定停留在 DOM 上
    await page.route("**/api/conversations**", async (route: any) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });
    await page.fill("textarea.hermes-textarea", "QA 思考动画探针");
    await page.click('button:has-text("发送")');
    await page.waitForSelector(".hermes-thinking", { state: "visible", timeout: 8000 });

    const thinking = await page.evaluate(() => {
      const el = document.querySelector(".hermes-thinking") as HTMLElement;
      const dots = el.querySelector(".hermes-thinking-dots");
      const label = el.querySelector(".hermes-thinking-label") as HTMLElement;
      return {
        role: el.getAttribute("role"),
        ariaLive: el.getAttribute("aria-live"),
        dotsHidden: dots ? dots.getAttribute("aria-hidden") : null,
        labelText: label ? (label.textContent || "") : "",
      };
    });
    ok(thinking.role === "status", `.hermes-thinking 外层 role="status"（实际 ${thinking.role}）`);
    ok(thinking.ariaLive === "polite", `.hermes-thinking 外层 aria-live="polite"（实际 ${thinking.ariaLive}）`);
    ok(thinking.dotsHidden === "true", `圆点容器 aria-hidden="true"（实际 ${thinking.dotsHidden}）`);
    ok(thinking.labelText.includes("检索"), `标签文本可见（${thinking.labelText}）`);

    section("运行时 B1：降动画下标签必须不透明可读");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(150);
    const reduceStyle = await page.evaluate(() => {
      const label = document.querySelector(".hermes-thinking-label") as HTMLElement;
      const cs = getComputedStyle(label);
      return {
        fill: cs.getPropertyValue("-webkit-text-fill-color") || (cs as any).webkitTextFillColor,
        color: cs.color,
        bgImage: cs.backgroundImage,
        bgColor: cs.backgroundColor,
      };
    });
    const reduceFill = parseRgb(reduceStyle.fill);
    ok(
      !!reduceFill && reduceFill.a > 0.99 && luminance(reduceFill) < 0.5,
      `reduce：-webkit-text-fill-color 为不透明深色（fill=${reduceStyle.fill}, color=${reduceStyle.color}, L=${reduceFill ? luminance(reduceFill).toFixed(3) : "n/a"}）`
    );
    ok(!/transparent/i.test(reduceStyle.fill) && reduceStyle.bgImage === "none", `reduce：已绕开渐变着色（bgImage=${reduceStyle.bgImage}）`);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(150);
    const sweepStyle = await page.evaluate(() => {
      const label = document.querySelector(".hermes-thinking-label") as HTMLElement;
      const cs = getComputedStyle(label);
      return {
        fill: cs.getPropertyValue("-webkit-text-fill-color") || (cs as any).webkitTextFillColor,
        bgImage: cs.backgroundImage,
      };
    });
    const sweepFill = parseRgb(sweepStyle.fill);
    ok(
      /linear-gradient/.test(sweepStyle.bgImage) && !!sweepFill && sweepFill.a < 0.01,
      `no-preference：渐变扫光 + 文字填充透明（bgImage=${sweepStyle.bgImage.slice(0, 60)}…, fill=${sweepStyle.fill}）`
    );

    // ---------- B5：404 页可达 ----------
    section("运行时 B5：not-found 页可达");
    const nfResp = await page.goto(`${BASE}/definitely-not-a-real-page`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    ok((await page.locator(".hermes-center-card").count()) > 0, `非路由页渲染居中卡片（HTTP ${nfResp ? nfResp.status() : "?"}）`);
    ok((await page.locator(".hermes-center-actions a").count()) === 2, "404 卡片含两个入口");
    ok((await page.locator("body").innerText()).includes("404"), "404 文案可见");
    const nfProject = await page.goto(`${BASE}/projects/00000000-0000-0000-0000-000000000000`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    ok((await page.locator(".hermes-center-card").count()) > 0, `不存在的项目渲染居中卡片（HTTP ${nfProject ? nfProject.status() : "?"}）`);

    // ---------- B4：error.tsx 的「重试」恢复 ----------
    // 说明：error.tsx 只会在**服务端渲染真的抛错**时出现；而 RSC 取数返回 500 时
    // Next 会回退为整页刷新（服务端渲染正常）→ 不会进入错误边界（本套已实测）。
    // 此前只调 reset() 对「服务端取数失败」无效（探针实测：0 新请求、内容不恢复），
    // 已修为先 router.refresh() 重取服务端数据、再 reset()，并用 useTransition 承接 pending。
    // 这里用源码守卫锁定该「refresh + reset」契约（运行时恢复仍无法不注入源码地持久复现）。
    const errorSrc = readSrc("app/error.tsx");
    const retryBlock = errorSrc.slice(errorSrc.indexOf("const retry"), errorSrc.indexOf("return ("));
    ok(
      /router\.refresh\(\)/.test(retryBlock) && /reset\(\)/.test(retryBlock),
      "error.tsx 的 retry() 同时调用 router.refresh() 与 reset()（能重取服务端数据）"
    );
    ok(/disabled=\{isRetrying\}/.test(errorSrc), "error.tsx 重试中禁用按钮（防连点）");

    // ---------- B7：理由对话框的取消安全性（最高风险） ----------
    section("运行时 B7：撤销获准「取消」= 0 写请求");
    await page.goto(`${BASE}/products/${product.id}?tab=launch`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=撤销获准", { timeout: 20000 });
    await page.waitForTimeout(500);

    const approvePath = `/api/launch/plans/${plan.id}/approve`;
    const countApproveDeletes = () => writes.filter((w) => w === `DELETE ${approvePath}`).length;

    // 打开对话框 → 空内容时确认按钮必须 disabled
    await page.getByRole("button", { name: "撤销获准" }).click();
    await page.waitForSelector(".hermes-modal-backdrop", { timeout: 5000 });
    ok(await page.locator('.hermes-modal-actions button[type="submit"]').isDisabled(), "空内容时确认按钮 disabled");
    const noteText = (await page.locator(".hermes-modal .hermes-note").innerText()).trim();
    ok(noteText === "理由为必填，将写入留痕。", `对话框说明文案正确（实际「${noteText}」）`);
    ok(!noteText.includes("为必填，将写入留痕。") || !/理由.*为必填/.test(noteText.replace("理由为必填", "")), "说明文案不含 label 拼接病句");

    // 取消按钮
    const beforeCancel = writes.length;
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.waitForTimeout(1000);
    ok((await page.locator(".hermes-modal-backdrop").count()) === 0, "点取消后对话框关闭");
    ok(writes.length === beforeCancel && countApproveDeletes() === 0, `点取消后 0 写请求（新增 ${writes.length - beforeCancel}，DELETE approve ${countApproveDeletes()}）`);

    // Esc
    const beforeEsc = writes.length;
    await page.getByRole("button", { name: "撤销获准" }).click();
    await page.waitForSelector(".hermes-modal-backdrop", { timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    ok((await page.locator(".hermes-modal-backdrop").count()) === 0, "按 Esc 后对话框关闭");
    ok(writes.length === beforeEsc && countApproveDeletes() === 0, `按 Esc 后 0 写请求（新增 ${writes.length - beforeEsc}）`);

    // 点遮罩
    const beforeBackdrop = writes.length;
    await page.getByRole("button", { name: "撤销获准" }).click();
    await page.waitForSelector(".hermes-modal-backdrop", { timeout: 5000 });
    await page.locator(".hermes-modal-backdrop").click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(800);
    ok((await page.locator(".hermes-modal-backdrop").count()) === 0, "点遮罩后对话框关闭");
    ok(writes.length === beforeBackdrop && countApproveDeletes() === 0, `点遮罩后 0 写请求（新增 ${writes.length - beforeBackdrop}）`);

    // 填理由确认 → 恰好 1 次 DELETE
    await page.getByRole("button", { name: "撤销获准" }).click();
    await page.waitForSelector(".hermes-modal-backdrop", { timeout: 5000 });
    await page.fill(".hermes-modal textarea", "QA 确认撤销理由");
    const beforeConfirm = countApproveDeletes();
    await page.locator('.hermes-modal-actions button[type="submit"]').click();
    await page.waitForTimeout(1500);
    ok(countApproveDeletes() - beforeConfirm === 1, `填理由确认后恰好 1 次 DELETE approve（实际 ${countApproveDeletes() - beforeConfirm}）`);

    // ---------- B6：原生弹窗计数恒为 0（跨多页触发理由对话框） ----------
    section("运行时 B6：跨页触发理由对话框，原生 dialog 恒为 0");
    let dialogDomSeen = 0;
    // consultation：处置反馈（理由对话框）
    await page.goto(`${BASE}/consultation`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const disposeBtn = page.getByRole("button", { name: "驳回" }).first();
    if (await disposeBtn.count()) {
      await disposeBtn.click();
      if (await page.locator(".hermes-modal-backdrop").count()) {
        dialogDomSeen += 1;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }
    // projects/[id]：退回修改（成果复核）
    await page.goto(`${BASE}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const rejectWork = page.getByRole("button", { name: "退回修改" }).first();
    if (await rejectWork.count()) {
      await rejectWork.click();
      if (await page.locator(".hermes-modal-backdrop").count()) {
        dialogDomSeen += 1;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }
    // war-room
    await page.goto(`${BASE}/war-room`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const wrReject = page.getByRole("button", { name: "退回修改" }).first();
    if (await wrReject.count()) {
      await wrReject.click();
      if (await page.locator(".hermes-modal-backdrop").count()) {
        dialogDomSeen += 1;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }
    // advisor（思考动画页）也走一遍
    await page.goto(`${BASE}/advisor`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    ok(dialogDomSeen >= 1, `至少出现过 1 次应用内理由对话框（证明非空跑；实际 ${dialogDomSeen}）`);
    ok(nativeDialogs.length === 0, `全程原生 dialog 计数为 0（实际 ${nativeDialogs.length}: ${nativeDialogs.join(" | ")}）`);

    // ---------- B8：局部刷新，不整页 reload ----------
    section("运行时 B8：局部刷新且列表更新");
    await page.goto(`${BASE}/consultation`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      (window as any).__qaSentinel = "kept";
      (window as any).__qaScroll = window.scrollY;
    });
    const beforeFeedbackWrite = writes.length;
    await page.fill("textarea.hermes-textarea", "QA 局部刷新哨兵反馈");
    await page.getByRole("button", { name: "提交反馈" }).click();
    // router.refresh() 是异步的：轮询等待新反馈渲染出来（最多 15s），避免固定等待造成的偶发抖动
    let feedbackAppeared = false;
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("QA 局部刷新哨兵反馈"),
        null,
        { timeout: 15000 }
      );
      feedbackAppeared = true;
    } catch {
      feedbackAppeared = false;
    }
    const sentinel = await page.evaluate(() => (window as any).__qaSentinel);
    const bodyText = await page.locator("body").innerText();
    const feedbackPost = writes.slice(beforeFeedbackWrite).find((w) => w.startsWith("POST /api/projects/") && w.endsWith("/feedback"));
    console.log(`    [B8 诊断] 提交后写请求=${JSON.stringify(writes.slice(beforeFeedbackWrite))}`);
    console.log(`    [B8 诊断] 页面是否含反馈文案=${bodyText.includes("QA 局部刷新哨兵反馈")}`);
    ok(sentinel === "kept", `window 哨兵未被整页刷新清除（实际 ${sentinel}）`);
    ok(!!feedbackPost, `确实发出了反馈写请求（${feedbackPost || "无"}）`);
    ok(feedbackAppeared, "提交后列表内容确实更新（出现新反馈）");

    // ---------- C1：知识库管理员的失败路径 → 页内横幅（工程师账号非管理员，测不到） ----------
    section("运行时 C1：管理员知识源失败 → 页内横幅（带 role/aria-live）");
    let sourceAbortMode = false;
    await page.route("**/api/knowledge/sources", async (route: any) => {
      if (sourceAbortMode) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "QA 注入的知识源失败" } }),
      });
    });
    await page.goto(`${BASE}/knowledge`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /管理知识源/ }).click();
    await page.waitForSelector(".hermes-modal", { timeout: 5000 });
    await page.getByRole("button", { name: /接入本地 Obsidian 目录/ }).click();
    await page.waitForTimeout(400);
    const modalInputs = page.locator(".hermes-modal input");
    await modalInputs.nth(0).fill("QA 探针知识源");
    await modalInputs.nth(1).fill("/tmp/qa-probe-source");
    await page.getByRole("button", { name: /确认接入/ }).click();
    await page.waitForTimeout(1200);
    const bannerA = page.locator(".hermes-banner");
    const bannerACount = await bannerA.count();
    const bannerAText = bannerACount ? (await bannerA.first().innerText()).trim() : "";
    const bannerARole = bannerACount ? await bannerA.first().getAttribute("role") : null;
    const bannerALive = bannerACount ? await bannerA.first().getAttribute("aria-live") : null;
    ok(bannerACount >= 1, `路径A（服务端 500）：出现页内横幅（未用 alert），文案「${bannerAText}」`);
    ok(
      bannerARole === "alert" && bannerALive === "assertive",
      `路径A 横幅含 role=alert + aria-live=assertive（实际 ${bannerARole}/${bannerALive}）`
    );
    ok(bannerAText.includes("QA 注入的知识源失败"), `路径A 横幅透出后端错误文案（${bannerAText}）`);

    // 路径 B：网络失败 → catch 分支
    sourceAbortMode = true;
    await page.getByRole("button", { name: /确认接入/ }).click();
    await page.waitForTimeout(1200);
    const bannerBText = (await page.locator(".hermes-banner").first().innerText()).trim();
    const bannerBRole = await page.locator(".hermes-banner").first().getAttribute("role");
    const bannerBLive = await page.locator(".hermes-banner").first().getAttribute("aria-live");
    ok(bannerBText.includes("失败"), `路径B（网络失败）：出现页内横幅，文案「${bannerBText}」`);
    ok(
      bannerBRole === "alert" && bannerBLive === "assertive",
      `路径B 横幅含 role=alert + aria-live=assertive（实际 ${bannerBRole}/${bannerBLive}）`
    );

    section("运行时 B6 收尾：原生弹窗仍为 0");
    ok(nativeDialogs.length === 0, `最终原生 dialog 计数为 0（实际 ${nativeDialogs.length}）`);
  } finally {
    await browser.close();
  }

  // ---------- 清理：仅本套夹具 ----------
  // 顺序：先清引用了 user 的会话（Conversation.owner 无级联），再删 user；Session 随 user 级联。
  await prisma.conversation.deleteMany({ where: { organizationId: org.id } });
  await prisma.launchMilestone.deleteMany({ where: { organizationId: org.id } });
  await prisma.launchPlan.deleteMany({ where: { organizationId: org.id } });
  await prisma.feedback.deleteMany({ where: { projectId: project.id } });
  await prisma.workItem.deleteMany({ where: { projectId: project.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await prisma.productVersion.deleteMany({ where: { productId: product.id } });
  await prisma.product.deleteMany({ where: { id: product.id } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.id, leader.id] } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  void feedback;

  return finish();
}

function finish() {
  console.log("\n" + "=".repeat(80));
  if (failures.length === 0) {
    console.log(`🏆 交互反馈层回归锁：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ 交互反馈层回归锁：${failures.length} 项未通过（通过 ${passed} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(80) + "\n");
}

main()
  .then(() => {
    if (failures.length > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error("\n❌ 交互反馈层回归锁中止:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
