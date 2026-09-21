/**
 * 一次性诊断探针：定位 `/projects/{id}` 在手机视口（390×844）下的横向溢出元素。
 *
 * 用途：`npm run test:ui`（tests/ui-b01-evidence.ts:236）报「手机视口横向溢出 9px」时，
 * 找出**具体是哪个元素**越界，避免用 `overflow-x: hidden` 掩盖问题。
 *
 * 运行（经 acc-server 启动服务并注入 BASE_URL/UI_BASE_URL）：
 *   bash scripts/acc-server.sh --port 3218 3219 scripts/_probe-ui-overflow.ts
 *
 * 只在测试库（`*_test` + 专用角色）运行；夹具自建自删；不写业务数据。
 * 结论由脚本自己打印，不参与验收断言。
 */
import crypto from "crypto";
import path from "path";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "../tests/test-safety";
import { hashPassword } from "../src/modules/identity/session";

const { chromium } = require("playwright");

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3111";
const RUN_TAG = `ovf${Date.now()}`;
const PASSWORD = `Overflow-${crypto.randomBytes(6).toString("hex")}!`;
const CHROME_PATH =
  process.env.CHROME_PATH ||
  "/Users/exasdwyh/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const VIEWPORT = { width: 390, height: 844 };

async function main() {
  await assertTestDatabaseSafety(prisma);

  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_ORG`, name: "溢出探针机构（合成夹具）" },
  });
  const owner = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-owner@hermes.test`,
      name: "溢出探针用户",
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
      productVersionId: productVersion.id,
      revision: 3,
      isDemo: true,
    },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: owner.id, role: "OWNER" },
  });
  const leader = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-leader@hermes.test`,
      name: "溢出探针决策人",
      organizationId: org.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: leader.id, role: "DECISION_MAKER" },
  });
  await prisma.project.update({
    where: { id: project.id },
    data: { decisionMakerId: leader.id, revision: 3 },
  });

  // 与 tests/ui-b01-evidence.ts 同构的「待审核批次 + 沿用成果 + 适用性说明」夹具
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
    data: {
      workItemId: workItem.id,
      attempt: 1,
      inputRevision: 2,
      submittedById: owner.id,
      status: "ACCEPTED",
      reviewReason: "首轮核对通过",
      reviewedById: owner.id,
      reviewedAt: new Date(),
    },
  });
  const submission2 = await prisma.workSubmission.create({
    data: { workItemId: workItem.id, attempt: 2, inputRevision: 3, submittedById: owner.id, status: "PENDING" },
  });
  await prisma.workItem.update({ where: { id: workItem.id }, data: { currentSubmissionId: submission2.id } });

  const specV1 = await prisma.artifact.create({
    data: {
      workItemId: workItem.id,
      submissionId: submission1.id,
      type: "SPECIFICATION_BRIEF",
      title: "产品规格简报",
      content: JSON.stringify({ netWeight: "探针 10g" }),
      contentVersion: 1,
      inputRevision: 2,
      reviewStatus: "ACCEPTED",
    },
  });
  const reportV1 = await prisma.artifact.create({
    data: {
      workItemId: workItem.id,
      submissionId: submission1.id,
      type: "MARKET_RESEARCH_REPORT",
      title: "市场研究报告（待验证草案）",
      content: JSON.stringify({ selectionRationale: "模板推断，待验证" }),
      contentVersion: 1,
      inputRevision: 2,
      reviewStatus: "ACCEPTED",
    },
  });
  await prisma.artifact.create({
    data: {
      workItemId: workItem.id,
      submissionId: submission2.id,
      type: "SPECIFICATION_BRIEF",
      title: "产品规格简报",
      content: JSON.stringify({ netWeight: "探针 20g" }),
      contentVersion: 2,
      inputRevision: 3,
      reviewStatus: "PENDING",
    },
  });
  await prisma.artifactApplicability.create({
    data: {
      artifactId: reportV1.id,
      submissionId: submission2.id,
      workItemId: workItem.id,
      baselineRevision: 3,
      sourceInputRevision: 2,
      contentHash: "probe-hash",
      status: "PENDING",
      note: "局部修订沿用市场研究报告 v1，待负责人确认适用于当前基线 r3",
    },
  });
  void specV1;

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', owner.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);

    await page.goto(`${BASE}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // 注意：用字符串形式注入，避免 tsx/esbuild 在函数体内注入 `__name` 辅助符（浏览器侧不存在）。
    const probeScript = `(() => {
      var vw = document.documentElement.clientWidth;
      var total = document.documentElement.scrollWidth - vw;
      var depthOf = function (n) { return n && n.parentElement ? 1 + depthOf(n.parentElement) : 0; };
      var offenders = [];
      document.querySelectorAll("*").forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        var over = Math.round(Math.max(r.right - vw, 0));
        var leftOver = Math.round(Math.max(-r.left, 0));
        if (over > 0.5 || leftOver > 0.5) {
          offenders.push({
            depth: depthOf(el),
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") || "").slice(0, 140),
            over: over,
            leftOver: leftOver,
            width: Math.round(r.width),
            left: Math.round(r.left),
            text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 70)
          });
        }
      });
      offenders.sort(function (a, b) { return b.depth - a.depth; });
      return { vw: vw, total: total, count: offenders.length, offenders: offenders.slice(0, 18) };
    })()`;
    const report = (await page.evaluate(probeScript)) as {
      vw: number;
      total: number;
      count: number;
      offenders: Array<Record<string, unknown>>;
    };

    console.log(`\n▶ 视口 ${VIEWPORT.width}px · clientWidth=${report.vw} · 总溢出=${report.total}px · 越界元素数=${report.count}`);
    for (const o of report.offenders) {
      console.log(
        `  depth=${o.depth} <${o.tag}> over=${o.over}px leftOver=${o.leftOver}px width=${o.width} left=${o.left}` +
          `\n      class="${o.cls}"\n      text="${o.text}"`
      );
    }
    if (report.total <= 0) console.log("  ✅ 未检出横向溢出（本次夹具/视口下）");
  } finally {
    await browser.close();
    await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
    await prisma.productVersion.deleteMany({ where: { productId: product.id } });
    await prisma.product.deleteMany({ where: { id: product.id } });
    await prisma.session.deleteMany({ where: { userId: owner.id } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    console.log("  🧹 探针夹具已清理");
  }
}

main()
  .catch((e) => {
    console.error("探针异常：", e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
