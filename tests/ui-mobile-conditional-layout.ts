import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";

const { chromium } = require("playwright");

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3221";
const OUT = process.env.OUTPUT_DIR || "/tmp/kern-mobile-layout";
const RUN = `layout-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const PASSWORD = `Layout-${crypto.randomBytes(8).toString("hex")}!`;

type OverflowProbe = {
  scrollWidth: number;
  clientWidth: number;
  overflow: number;
  offenders: Array<{ tag: string; cls: string; text: string; right: number; width: number }>;
};

async function probeOverflow(page: any): Promise<OverflowProbe> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const vw = root.clientWidth;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .flatMap((el) => {
        const node = el as HTMLElement;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
        if (!visible || rect.right <= vw + 1) return [];
        return [{
          tag: node.tagName.toLowerCase(),
          cls: String(node.className || "").slice(0, 80),
          text: String(node.innerText || "").replace(/\s+/g, " ").slice(0, 80),
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        }];
      })
      .slice(0, 12);
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflow: root.scrollWidth - root.clientWidth,
      offenders,
    };
  });
}

async function login(page: any, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1600);
  assert.equal(page.url().includes("/login"), false, `登录失败：${page.url()}`);
}

async function launchState(page: any, productId: string, tier: string) {
  await page.goto(`${BASE}/products/${productId}?tab=launch`, { waitUntil: "domcontentloaded" });
  const button = page.getByRole("button", { name: "建立上市计划" });
  await button.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await button.isDisabled(), false, "上市计划按钮不应被权限禁用");
  await button.click();
  await page.getByRole("heading", { name: "建立上市计划" }).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  const probe = await probeOverflow(page);
  console.log(`[B1 launch ${tier}] scroll=${probe.scrollWidth} client=${probe.clientWidth} overflow=${probe.overflow}`);
  if (probe.offenders.length) console.log("[B1 launch offenders]", JSON.stringify(probe.offenders));
  await page.screenshot({ path: path.join(OUT, `launch-${tier}.png`), fullPage: true });
  assert.ok(probe.overflow <= 1, `B1 launch ${tier} 横向溢出 ${probe.overflow}px`);
}

async function costState(page: any, productId: string, tier: string) {
  await page.goto(`${BASE}/products/${productId}?tab=cost`, { waitUntil: "domcontentloaded" });
  const values: Array<[RegExp, string]> = [
    [/直接材料成本/, "10"],
    [/外包装成本/, "2"],
    [/制造成本/, "3"],
    [/认证成本/, "1"],
    [/月固定成本/, "1000"],
    [/含税零售价/, "99"],
  ];
  for (const [label, value] of values) {
    await page.getByLabel(label).fill(value);
  }
  await page.getByRole("button", { name: "计算经济性" }).click();
  await page.locator('input[placeholder*="情景名称"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  const probe = await probeOverflow(page);
  console.log(`[B1 cost ${tier}] scroll=${probe.scrollWidth} client=${probe.clientWidth} overflow=${probe.overflow}`);
  if (probe.offenders.length) console.log("[B1 cost offenders]", JSON.stringify(probe.offenders));
  await page.screenshot({ path: path.join(OUT, `cost-${tier}.png`), fullPage: true });
  assert.ok(probe.overflow <= 1, `B1 cost ${tier} 横向溢出 ${probe.overflow}px`);
}

async function bubbleState(page: any) {
  await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
  await page.locator(".bubble-scroll").first().waitFor({ state: "visible", timeout: 10000 });
  const probe = await page.evaluate(() => {
    const scroller = document.querySelector(".bubble-scroll") as HTMLElement | null;
    const axis = document.querySelector(".bubble-axis-y") as HTMLElement | null;
    if (!scroller || !axis) return null;
    const sr = scroller.getBoundingClientRect();
    const ar = axis.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    return {
      scrollerLeft: sr.left,
      axisLeft: ar.left,
      axisRight: ar.right,
      clippedLeft: Math.max(0, sr.left - ar.left),
      overflowX: style.overflowX,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
    };
  });
  assert.ok(probe, "B2 未找到气泡轴实际 DOM");
  console.log("[B2 bubble 390]", JSON.stringify(probe));
  await page.screenshot({ path: path.join(OUT, "bubble-390.png"), fullPage: true });
  assert.ok((probe?.clippedLeft ?? 0) <= 1, `B2 bubble Y 轴左侧被裁 ${probe?.clippedLeft}px`);
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  fs.mkdirSync(OUT, { recursive: true });

  const org = await prisma.organization.create({
    data: { code: `${RUN}_ORG`, name: "移动布局验收组织" },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${RUN}@hermes.test`,
      name: "布局验收负责人",
      passwordHash: hashPassword(PASSWORD),
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      name: "移动布局验收产品",
      identityCode: `${RUN}_SKU`,
      targetAudience: "布局验收人群",
      marketPath: "验收渠道",
      devMode: "NEW_PRODUCT",
      ownerId: owner.id,
      lifecycleStage: "ANALYSIS",
    },
  });
  const version = await prisma.productVersion.create({
    data: {
      productId: product.id,
      versionTag: "layout-v1",
      specs: { fixture: true },
      targetCost: 30,
      currency: "CNY",
      isConfirmed: true,
      isImmutable: true,
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      mode: "NEW_PRODUCT",
      title: "移动布局验收项目",
      target: "只用于 390px 条件态验证",
      stage: "RESEARCH",
      ownerId: owner.id,
      decisionMakerId: owner.id,
      productId: product.id,
      productVersionId: version.id,
      isDemo: true,
    },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: owner.id, role: "OWNER" },
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });

  try {
    for (const [tier, width, height] of [["1440", 1440, 900], ["390", 390, 844]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, locale: "zh-CN" });
      const page = await context.newPage();
      await login(page, owner.email);
      await launchState(page, product.id, tier);
      await costState(page, product.id, tier);
      if (tier === "390") await bubbleState(page);
      await context.close();
    }
  } finally {
    await browser.close();
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log("✅ B1/B2 条件态布局验证通过");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
