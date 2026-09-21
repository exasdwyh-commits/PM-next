/**
 * B01-03 UI 证据采集（桌面 + 手机视口）
 *
 * 目的：留下真实页面证据（登录、项目工作台、审核提示），并检查两个视口下
 * 无横向溢出、状态与错误可见。不做视觉美化校验，只采集可复核的证据。
 *
 * 前置：
 *   1) 开发模式服务（Cookie 非 Secure，便于 http 下交互）：
 *      DEV_MOCK_AUTH=false DATABASE_URL=<测试库> npx next dev -p 3111
 *   2) playwright 从既有工程复用（本机未重复安装）：
 *      NODE_PATH=<cockpit-truth>/node_modules npx tsx tests/ui-b01-evidence.ts
 *
 * 输出：截图写入 OUTPUT_DIR（默认 ../../outputs/b01-ui-<时间戳>），不含任何凭证。
 */

import path from "path";
import fs from "fs";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";
import crypto from "crypto";

const { chromium } = require("playwright");

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3111";
const RUN_TAG = `ui${Date.now()}`;
const PASSWORD = `Ui-Evidence-${crypto.randomBytes(6).toString("hex")}!`;
const CHROME_PATH =
  process.env.CHROME_PATH ||
  "/Users/exasdwyh/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const OUTPUT_DIR =
  process.env.OUTPUT_DIR ||
  path.join(process.cwd(), "..", "outputs", `b01-ui-${new Date().toISOString().slice(0, 10)}`);

const checks: string[] = [];
const failures: string[] = [];

function ok(cond: boolean, msg: string) {
  if (cond) {
    checks.push(msg);
    console.log(`  ✔ ${msg}`);
  } else {
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ---------- 夹具：账号 + 项目 + 待审核批次（含沿用成果） ----------
  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_ORG`, name: "UI 证据机构（合成夹具）" },
  });
  const owner = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-owner@hermes.test`,
      name: "UI 负责人",
      organizationId: org.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });
  const leader = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-leader@hermes.test`,
      name: "UI 决策人",
      organizationId: org.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      name: "UI 证据产品",
      identityCode: `${RUN_TAG}-UI-PRODUCT`,
      targetAudience: "中老年私域人群（合成夹具）",
      marketPath: "私域",
      devMode: "NEW_PRODUCT",
    },
  });
  const productVersion = await prisma.productVersion.create({
    data: {
      productId: product.id,
      versionTag: `${RUN_TAG}-v1`,
      specs: { netWeight: "UI 10g" },
      targetCost: 12,
      currency: "CNY",
      isConfirmed: true,
      isImmutable: true,
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      title: `${RUN_TAG}_UI 证据项目`,
      target: "蓝莓花青素固体饮料（合成夹具）",
      mode: "NEW_PRODUCT",
      stage: "RESEARCH",
      ownerId: owner.id,
      decisionMakerId: leader.id,
      productVersionId: productVersion.id,
      revision: 3,
      isDemo: true,
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: "OWNER" },
      { projectId: project.id, userId: leader.id, role: "DECISION_MAKER" },
    ],
  });

  const workItem = await prisma.workItem.create({
    data: {
      projectId: project.id,
      title: "产品定义与可行性研判",
      target: "完成需求拆解与规格简报",
      deliverableReq: "产品规格简报与市场研究报告",
      status: "SUBMITTED",
      inputRevision: 3,
    },
  });
  const submission1 = await prisma.workSubmission.create({
    data: { workItemId: workItem.id, attempt: 1, inputRevision: 2, submittedById: owner.id, status: "ACCEPTED", reviewReason: "首轮核对通过", reviewedById: owner.id, reviewedAt: new Date() },
  });
  const submission2 = await prisma.workSubmission.create({
    data: { workItemId: workItem.id, attempt: 2, inputRevision: 3, submittedById: owner.id, status: "PENDING" },
  });
  await prisma.workItem.update({ where: { id: workItem.id }, data: { currentSubmissionId: submission2.id } });

  const specV1 = await prisma.artifact.create({
    data: { workItemId: workItem.id, submissionId: submission1.id, type: "SPECIFICATION_BRIEF", title: "产品规格简报", content: JSON.stringify({ netWeight: "UI 10g" }), contentVersion: 1, inputRevision: 2, reviewStatus: "ACCEPTED" },
  });
  const reportV1 = await prisma.artifact.create({
    data: { workItemId: workItem.id, submissionId: submission1.id, type: "MARKET_RESEARCH_REPORT", title: "市场研究报告（待验证草案）", content: JSON.stringify({ selectionRationale: "模板推断，待验证" }), contentVersion: 1, inputRevision: 2, reviewStatus: "ACCEPTED" },
  });
  await prisma.artifact.create({
    data: { workItemId: workItem.id, submissionId: submission2.id, type: "SPECIFICATION_BRIEF", title: "产品规格简报", content: JSON.stringify({ netWeight: "UI 20g" }), contentVersion: 2, inputRevision: 3, reviewStatus: "PENDING" },
  });
  await prisma.artifactApplicability.create({
    data: {
      artifactId: reportV1.id,
      submissionId: submission2.id,
      workItemId: workItem.id,
      baselineRevision: 3,
      sourceInputRevision: 2,
      contentHash: "ui-evidence-hash",
      status: "PENDING",
      note: "局部修订沿用市场研究报告 v1，待负责人确认适用于当前基线 r3",
    },
  });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });

  const consoleErrors: string[] = [];
  const networkIssues: string[] = [];
  // 预期噪音：未登录时 /api/auth/session 的 401、缺失的 favicon
  // 预期噪音还包括：Next 预取被导航中断的 RSC 请求（ERR_ABORTED），非业务错误
  const EXPECTED_NOISE = [
    /\/api\/auth\/session/,
    /favicon/,
    /\/_next\/static\/development/,
    /_rsc=/,
    /ERR_ABORTED/,
  ];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("console", (msg: any) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("response", (resp: any) => {
    if (resp.status() >= 400) networkIssues.push(`${resp.status()} ${resp.url()}`);
  });
  page.on("requestfailed", (req: any) => {
    networkIssues.push(`FAILED ${req.url()} (${req.failure()?.errorText ?? "unknown"})`);
  });

  try {
    // ---------- 1. 未登录跳转登录页 ----------
    console.log("\n▶ 桌面视口 (1440×900)");
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    ok(page.url().includes("/login"), `未登录访问首页跳转登录页（${page.url()}）`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "01-desktop-login.png"), fullPage: false });

    // ---------- 2. 错误凭证提示 ----------
    await page.fill('input[type="email"]', owner.email);
    await page.fill('input[type="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    const errorVisible = await page.locator('[role="alert"]').count();
    ok(errorVisible > 0, "错误凭证在页面上有明确错误提示");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "02-desktop-login-error.png") });

    // ---------- 3. 正确登录 ----------
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    ok(!page.url().includes("/login"), `正确凭证登录成功并离开登录页（${page.url()}）`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "03-desktop-workbench.png"), fullPage: false });

    // ---------- 4. 项目详情与审核提示 ----------
    await page.goto(`${BASE}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const bodyText = await page.locator("body").innerText();
    ok(bodyText.includes("第 2 批审核提示"), "审核页展示当前批次审核提示");
    ok(bodyText.includes("本次变化"), "审核页列出本次变化成果");
    ok(bodyText.includes("沿用成果"), "审核页列出沿用成果及其原始版本");
    ok(bodyText.includes("尚未确认"), "审核页列出尚未确认的内容");
    ok(bodyText.includes("原始输入基线 r2"), "沿用成果标注原始输入基线");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "04-desktop-project-detail.png"), fullPage: true });

    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    ok(desktopOverflow <= 0, `桌面视口无横向溢出（溢出 ${desktopOverflow}px）`);

    // ---------- 5. 手机视口 ----------
    console.log("\n▶ 手机视口 (390×844)");
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await context.storageState(),
    });
    const mpage = await mobile.newPage();
    await mpage.goto(`${BASE}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await mpage.waitForTimeout(2500);
    const mobileOverflow = await mpage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    ok(mobileOverflow <= 0, `手机视口无横向溢出（溢出 ${mobileOverflow}px）`);
    await mpage.screenshot({ path: path.join(OUTPUT_DIR, "05-mobile-project-detail.png"), fullPage: true });

    await mpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await mpage.waitForTimeout(1200);
    await mpage.screenshot({ path: path.join(OUTPUT_DIR, "06-mobile-login.png") });

    // Targeted logout regression: discard the authenticated session via the page.
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.waitForURL("**/login");
    await page.goto(`${BASE}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    ok(page.url().includes("/login"), "点击退出后旧项目链接要求重新登录");
    await page.reload();
    ok(page.url().includes("/login"), "退出后刷新仍为登录页");

    // ---------- 6. 控制台错误 ----------
    const unexpectedNetwork = networkIssues.filter((n) => !EXPECTED_NOISE.some((re) => re.test(n)));
    ok(
      unexpectedNetwork.length === 0,
      `无非预期的接口/资源错误（共记录 ${networkIssues.length} 条，非预期 ${unexpectedNetwork.length} 条）${unexpectedNetwork
        .slice(0, 3)
        .join(" | ")}`
    );
    console.log(`   网络记录: ${networkIssues.join(" | ") || "无"}`);

    console.log(`\n截图输出目录: ${OUTPUT_DIR}`);
  } finally {
    await browser.close();
  }

  // ---------- 清理：仅本套夹具 ----------
  await prisma.artifactApplicability.deleteMany({ where: { workItemId: workItem.id } });
  await prisma.artifact.deleteMany({ where: { workItemId: workItem.id } });
  await prisma.workSubmission.deleteMany({ where: { workItemId: workItem.id } });
  await prisma.workItem.deleteMany({ where: { projectId: project.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await prisma.productVersion.deleteMany({ where: { productId: product.id } });
  await prisma.product.deleteMany({ where: { id: product.id } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: [owner.id, leader.id] } } });
  await prisma.user.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });

  console.log("\n================================================================================");
  if (failures.length === 0) {
    console.log(`🏆 B01-03 UI 证据采集完成：${checks.length} 项检查全部通过`);
  } else {
    console.log(`❌ UI 证据检查 ${failures.length} 项未通过（通过 ${checks.length} 项）`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
  console.log("================================================================================\n");
}

main()
  .catch((error) => {
    console.error("\n❌ UI 证据采集中止:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
