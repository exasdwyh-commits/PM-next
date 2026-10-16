/**
 * 建品提议卡「浏览器验收」（真实 Chromium + 真实页面渲染 + 真实数据库）
 *
 * 与纯筛选/单测的区别：这里必须在**渲染出来的页面**上验证，不能只验 listProposals 的过滤条件——
 * 此前卡片被 `decision.gate !== "Proposal / Approval"` 一句过滤掉，服务端数据完全正确，
 * 但用户在产生提议的那个会话里根本看不到卡片。这类问题只有渲染验收能发现。
 *
 * 前置：
 *   1) 开发模式服务（Cookie 非 Secure，便于 http 下交互；DEV_MOCK_AUTH 打开后可用
 *      `x-user-id` 头直接进入，登录页不作为本轮验收内容，避免它成为噪声）：
 *      DEV_MOCK_AUTH=true DATABASE_URL=$TEST_DATABASE_URL npx next dev -p 3331
 *   2) 运行（playwright 用本工程自带的；若自带版本与本机缓存的 chromium 修订号不一致，
 *      用 CHROME_PATH 指向已安装的 chrome.exe）：
 *      UI_BASE_URL=http://127.0.0.1:3331 npx tsx tests/ui-intake-confirm-card.ts
 *
 * 覆盖：本会话有卡/其它会话与空归属无卡 · 短按不提交长按 600ms 才提交 · 提交中禁用 ·
 *       批准后产品/初始版本/项目各一条且刷新不复活 · 失败不隐藏卡片不误报成功且可重试（幂等键不变） ·
 *       拒绝不创建业务记录且理由落库 · 请求中切会话不串消息 · 稍后处理语义（不写库）。
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { hashPassword } from "../src/modules/identity/session";

const { chromium } = require("playwright");

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3111";
const CHROME_PATH = process.env.CHROME_PATH || chromium.executablePath();
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join("outputs", `ui-confirm-${Date.now()}`);
/** HoldToConfirm 的阈值是 600ms：短按 200ms 必须无效，长按 700ms 才提交 */
const SHORT_PRESS_MS = 200;
const LONG_PRESS_MS = 700;

const RUN_TAG = `uic${Date.now()}`;
const PASSWORD = `Ui-Confirm-${crypto.randomBytes(6).toString("hex")}!`;
const FIVE = {
  name: "蓝莓花青素固体饮料",
  coreIdea: "给久坐上班族的护眼固体饮料",
  targetAudience: "25-40 岁久坐上班族",
  coreSellingPoints: "花青素含量可标注、低糖、冷水即溶",
  targetChannels: "抖音自播 + 私域复购",
};

interface Row {
  id: string;
  scene: string;
  result: "PASS" | "FAIL";
  evidence: string;
}
const results: Row[] = [];
let failures = 0;
const record = (id: string, scene: string, result: "PASS" | "FAIL", evidence: string) => {
  results.push({ id, scene, result, evidence });
  if (result === "FAIL") failures += 1;
  console.log(`  ${result === "PASS" ? "✅" : "❌"} ${id} ${scene} — ${evidence}`);
};
const must = (cond: boolean, message: string) => {
  if (!cond) throw new Error(message);
};

async function main() {
  await assertTestDatabaseSafety(prisma);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ---------- 夹具 ----------
  const org = await prisma.organization.create({
    data: { code: `${RUN_TAG}_ORG`, name: "UI 提议卡机构（合成夹具）" },
  });
  const user = await prisma.user.create({
    data: {
      email: `${RUN_TAG}-owner@hermes.test`,
      name: "UI 负责人",
      organizationId: org.id,
      passwordHash: hashPassword(PASSWORD),
    },
  });
  // 组织级角色在 OrganizationMember 上（User 本身没有 role 字段）
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "ORG_ADMIN" },
  });
  const convA = await prisma.conversation.create({
    data: { organizationId: org.id, ownerId: user.id, title: `A-${RUN_TAG}` },
  });
  const convB = await prisma.conversation.create({
    data: { organizationId: org.id, ownerId: user.id, title: `B-${RUN_TAG}` },
  });
  // 每个会话确认成功后会被绑定到新建的产品（事务内保证「产品已建 + 会话已绑定」），
  // 因此再确认同一会话的第二条建品提议会被服务端拒绝。验收里每条要落库的提议各用一个会话。
  const convC = await prisma.conversation.create({
    data: { organizationId: org.id, ownerId: user.id, title: `C-${RUN_TAG}` },
  });
  const mk = (conversationId: string | null) =>
    prisma.actionProposal.create({
      data: {
        organizationId: org.id,
        conversationId,
        actionType: "CREATE_PRODUCT",
        payloadJson: { ...FIVE, rationale: "来自本会话对话内容整理" },
        status: "PENDING_CONFIRMATION",
        proposedById: user.id,
      },
    });
  const pA = await mk(convA.id); // 本会话
  const pC = await mk(convC.id); // 批准写入（独立会话，避免与 S4 的绑定冲突）
  const pNull = await mk(null); // 空归属
  const pB = await mk(convB.id); // 其它会话
  const pDefer = await mk(convA.id); // 稍后处理
  const pReject = await mk(convA.id); // 拒绝
  const pSwitch = await mk(convA.id); // 请求中切会话

  const counts = async () => ({
    products: await prisma.product.count({ where: { organizationId: org.id } }),
    versions: await prisma.productVersion.count({ where: { product: { organizationId: org.id } } }),
    projects: await prisma.project.count({ where: { organizationId: org.id } }),
  });

  /**
   * 轮询等待提议落到目标状态。
   * dev 模式下首次命中的路由需要编译，固定 sleep 会把「还没编完」误判成功能失败，
   * 因此最终态一律用轮询断言，并把实际等待时长写进证据。
   */
  const waitProposalStatus = async (id: string, status: string, timeoutMs = 25000) => {
    const started = Date.now();
    let last = "(未读到)";
    while (Date.now() - started < timeoutMs) {
      const row = await prisma.actionProposal.findUnique({ where: { id } });
      last = row?.status ?? "(未读到)";
      if (last === status) return { ok: true, waitedMs: Date.now() - started, last };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const row = await prisma.actionProposal.findUnique({ where: { id } });
    return { ok: false, waitedMs: Date.now() - started, last: row?.status ?? last };
  };

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: { "x-user-id": user.id, "x-organization-id": org.id },
  });
  const page = await context.newPage();
  const confirmCalls: { url: string; key: string | null }[] = [];
  page.on("request", (req: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (req.method() === "POST" && /\/api\/proposals\/[^/]+\/confirm$/.test(req.url())) {
      confirmCalls.push({ url: req.url(), key: (req.headers() as Record<string, string>)["idempotency-key"] ?? null });
    }
  });
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: false });
  };
  const open = async (conversationId: string) => {
    await page.goto(`${BASE}/muse?c=${conversationId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
  };
  const pick = async (title: string) => {
    // 点标题文字而不是整行：行右侧的「置顶/重命名/归档」操作区会遮挡行中央的点击点。
    await page.locator(`button.m-goal[title="${title}"] .m-goal-title`).first().click();
    await page.waitForTimeout(1600);
  };
  const card = (id: string) => page.locator(`[data-decision-id="${id}"]`);
  const holdApprove = async (proposalId: string, ms: number) => {
    const btn = card(proposalId).locator('button[data-testid="checkin-approve"]').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await page.waitForTimeout(150);
    const box = await btn.boundingBox();
    if (!box) throw new Error(`找不到提议 ${proposalId} 的批准按钮`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };

  try {
    // ---------- 进入会话（开发态 mock 鉴权头） ----------
    await page.goto(`${BASE}/muse?c=${convA.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    must(!page.url().includes("/login"), `应直接进入 Kern 页面（${page.url()}）；请以 DEV_MOCK_AUTH=true 启动开发服务`);
    await open(convA.id);

    // ---------- S1 渲染：本会话有卡，其它会话与空归属无卡 ----------
    const inA = {
      self: await card(pA.id).count(),
      other: await card(pB.id).count(),
      nullOwned: await card(pNull.id).count(),
    };
    const aText = await card(pA.id).first().innerText();
    const pageHtml = await page.content();
    const hasAllFive = Object.values(FIVE).every((v) => aText.includes(v));
    await shot("01-convA-card");
    must(inA.self === 1, `本会话应出现 1 张提议卡，实际 ${inA.self}`);
    must(inA.other === 0, `其它会话的提议不应出现在本会话，实际 ${inA.other}`);
    must(inA.nullOwned === 0, `空归属提议不应出现在任何会话，实际 ${inA.nullOwned}`);
    must(hasAllFive, `卡片摘要应列出五项内容，实际卡片文本：${aText.slice(0, 200)}`);
    must(!pageHtml.includes("Proposal / Approval"), "界面不应再出现英文 gate 标识 Proposal / Approval");
    must(aText.includes("需你批准的业务写入"), `gate 应为中文，实际：${aText.slice(0, 200)}`);
    must(
      aText.includes("依据是你在本会话里说的五项内容"),
      `空证据提示应为建品口径，实际：${aText.slice(0, 300)}`
    );
    record("S1", "渲染：本会话有卡、其它会话与空归属无卡、摘要/中文 gate/空证据提示", "PASS",
      `本会话=${inA.self} 其它会话=${inA.other} 空归属=${inA.nullOwned}；摘要含五项；gate=需你批准的业务写入`);

    // ---------- S2 切到其它会话：本会话的卡不跟着走 ----------
    await pick(convB.title);
    const inB = {
      self: await card(pB.id).count(),
      other: await card(pA.id).count(),
      nullOwned: await card(pNull.id).count(),
    };
    await shot("02-convB-card");
    must(inB.self === 1, `会话 B 应出现自己的提议卡，实际 ${inB.self}`);
    must(inB.other === 0, `会话 A 的提议不应出现在会话 B，实际 ${inB.other}`);
    must(inB.nullOwned === 0, `空归属提议不应出现在会话 B，实际 ${inB.nullOwned}`);
    record("S2", "渲染：切到其它会话，原会话卡片不出现、空归属仍不出现", "PASS",
      `B 自己的卡=${inB.self}，A 的卡=${inB.other}，空归属=${inB.nullOwned}`);

    // ---------- S3 短按不提交 ----------
    await pick(convA.title);
    const before = confirmCalls.length;
    await holdApprove(pA.id, SHORT_PRESS_MS);
    await page.waitForTimeout(1500);
    const shortPressed = confirmCalls.length - before;
    const stillPending = (await card(pA.id).count()) === 1;
    must(shortPressed === 0, `短按 ${SHORT_PRESS_MS}ms 不应发起确认请求，实际 ${shortPressed} 次`);
    must(stillPending, "短按后卡片应保持待确认，不应消失");
    record("S3", "短按不提交（200ms 松开）", "PASS", `确认请求 ${shortPressed} 次；卡片仍在待确认`);

    // ---------- S4 提交中禁用 + 请求中切会话不串消息 ----------
    const before4 = await counts();
    await page.route("**/api/proposals/*/confirm", async (route: any) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });
    await holdApprove(pSwitch.id, LONG_PRESS_MS);
    await page.waitForTimeout(900); // 请求在途
    const busyAttr = await card(pSwitch.id).first().getAttribute("data-busy");
    const rejectDisabled = await card(pSwitch.id).locator('[data-testid="checkin-reject"]').first().isDisabled();
    const deferDisabled = await card(pSwitch.id).locator('[data-testid="checkin-defer"]').first().isDisabled();
    await shot("03-inflight-busy");
    await pick(convB.title); // 在途期间切会话
    await page.waitForTimeout(5000); // 等在途请求返回
    const bText = await page.locator("body").innerText();
    const leaked = bText.includes("已按你的批准执行并写入回执。");
    await shot("04-after-switch");
    await pick(convA.title);
    // 在途切走后，回执消息被有意丢弃（不许串到别的会话）；回到原会话时，
    // 正确状态由服务端数据说话：已执行的提议不再出现在待确认区。
    const cardGoneInA = (await card(pSwitch.id).count()) === 0;
    const after4 = await counts();
    await page.unroute("**/api/proposals/*/confirm");
    must(busyAttr !== null, "请求在途时卡片应带 data-busy（按钮禁用）");
    must(rejectDisabled && deferDisabled, `在途时「拒绝/稍后处理」应禁用（reject=${rejectDisabled}, defer=${deferDisabled}）`);
    must(!leaked, "在途响应不应把回执消息串到切换后的会话");
    must(cardGoneInA, "回到原会话后，已批准的提议卡应消失（服务端已执行，不是本地假装成功）");
    must(after4.products === before4.products + 1,
      `切会话后请求仍应真正落库：product ${before4.products}→${after4.products}`);
    record("S4", "提交中禁用 + 请求中切会话不串消息", "PASS",
      `在途 data-busy=${busyAttr !== null}，拒绝/稍后均禁用；切走的会话无回执；回到原会话卡片消失=${cardGoneInA}；product ${before4.products}→${after4.products}`);

    // ---------- S5 批准后各一条 + 刷新不复活 ----------
    await pick(convC.title);
    const before5 = await counts();
    await holdApprove(pC.id, LONG_PRESS_MS);
    await page.waitForTimeout(1500);
    try {
      await page.waitForSelector(`[data-decision-id="${pC.id}"]`, { state: "detached", timeout: 15000 });
    } catch {
      // 等不到消失就把卡片当前文案留下来，失败信息里能直接看到服务端原因
      const left = await card(pC.id).first().innerText().catch(() => "<卡片已消失>");
      console.log(`   · pC 卡片仍未消失，页面文案：${left.slice(0, 300)}`);
    }
    const after5 = await counts();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    const afterReload = await card(pC.id).count();
    await shot("05-after-approve-reload");
    must(
      after5.products === before5.products + 1 &&
        after5.versions === before5.versions + 1 &&
        after5.projects === before5.projects + 1,
      `批准后应各写 1 条：product ${before5.products}→${after5.products}, version ${before5.versions}→${after5.versions}, project ${before5.projects}→${after5.projects}`
    );
    must(afterReload === 0, `刷新后不应再出现已执行的提议卡，实际 ${afterReload}`);
    // 同键再次确认：返回幂等回执且不重复写入
    const replay = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/proposals/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `muse:proposal:${id}:approve` },
        body: "{}",
      });
      return { status: res.status, json: await res.json() };
    }, pC.id);
    const after5b = await counts();
    must(replay.status === 200 && replay.json.idempotent === true,
      `同幂等键重复确认应命中回执（status=${replay.status}, idempotent=${replay.json.idempotent}）`);
    must(after5b.products === after5.products, `幂等重放不应再建产品（${after5.products}→${after5b.products}）`);
    record("S5", "批准后产品/初始版本/项目各一条、刷新不复活、同键幂等", "PASS",
      `product ${before5.products}→${after5.products}，version +1，project +1；刷新后卡片=${afterReload}；重放 idempotent=true 且未再写入`);

    // ---------- S6 拒绝不创建业务记录、理由落库 ----------
    await pick(convA.title);
    const before6 = await counts();
    await card(pReject.id).locator('[data-testid="checkin-reject"]').first().click();
    await page.waitForTimeout(800);
    await page.fill("#m-reject-reason", "证据不足，暂不建品（浏览器验收）");
    await shot("06-reject-sheet");
    await page.click('button[type="submit"]:has-text("确认拒绝")');
    const waitReject = await waitProposalStatus(pReject.id, "REJECTED", 25000);
    if (!waitReject.ok) {
      const left = await card(pReject.id).first().innerText().catch(() => "<卡片已消失>");
      console.log(`   · 拒绝后卡片未进入 REJECTED，页面文案：${left.slice(0, 300)}`);
    }
    const after6 = await counts();
    const rejected = await prisma.actionProposal.findUniqueOrThrow({ where: { id: pReject.id } });
    must(
      after6.products === before6.products &&
        after6.versions === before6.versions &&
        after6.projects === before6.projects,
      `拒绝不应产生任何业务记录：product ${before6.products}→${after6.products}, version ${before6.versions}→${after6.versions}, project ${before6.projects}→${after6.projects}`
    );
    must(waitReject.ok, `提议状态应为 REJECTED（等待 ${waitReject.waitedMs}ms），实际 ${rejected.status}`);
    must((rejected.decisionReason ?? "").includes("证据不足"), `拒绝理由应落库，实际 ${rejected.decisionReason}`);
    record("S6", "拒绝不创建业务记录、理由落库", "PASS",
      `业务记录 0 新增（product ${before6.products}→${after6.products}）；状态=${rejected.status}（等待 ${waitReject.waitedMs}ms）；理由=${rejected.decisionReason}`);

    // ---------- S7 失败不隐藏卡片、不误报成功、可重试 ----------
    await pick(convB.title);
    await page.route("**/api/proposals/*/confirm", (route: any) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "模拟服务端故障（浏览器验收）" }),
      })
    );
    const before7 = await counts();
    await holdApprove(pB.id, LONG_PRESS_MS);
    await page.waitForTimeout(2500);
    const cardStill = await card(pB.id).count();
    const errorText = await card(pB.id).locator('[data-testid="checkin-error"]').first().innerText().catch(() => "");
    const retryVisible = await card(pB.id).locator('[data-testid="checkin-retry"]').first().isVisible().catch(() => false);
    const body7 = await page.locator("body").innerText();
    const falseSuccess = body7.includes("已按你的批准执行并写入回执。");
    const after7 = await counts();
    await shot("07-failure-state");
    must(cardStill === 1, `失败后卡片必须仍在原处，实际 ${cardStill}`);
    must(errorText.includes("模拟服务端故障"), `应显示失败原因，实际 ${errorText.slice(0, 120)}`);
    must(retryVisible, "失败后应给出「重试」入口");
    must(!falseSuccess, "失败不得显示成功回执");
    must(after7.products === before7.products, `失败不应写入业务数据（${before7.products}→${after7.products}）`);

    await page.unroute("**/api/proposals/*/confirm");
    await card(pB.id).locator('[data-testid="checkin-retry"]').first().click();
    await page.waitForTimeout(4000);
    const after7b = await counts();
    const keys = confirmCalls.filter((c) => c.url.includes(pB.id)).map((c) => c.key);
    await shot("08-retry-success");
    must(
      after7b.products === before7.products + 1 &&
        after7b.versions === before7.versions + 1 &&
        after7b.projects === before7.projects + 1,
      `重试成功后应各写 1 条而不是 2 条：product ${before7.products}→${after7b.products}, version ${before7.versions}→${after7b.versions}, project ${before7.projects}→${after7b.projects}`
    );
    must(keys.length >= 2 && new Set(keys).size === 1,
      `重试应沿用同一个幂等键，实际 ${JSON.stringify(keys)}`);
    record("S7", "失败不隐藏卡片/不误报成功，重试成功且幂等键不变", "PASS",
      `失败时卡片仍在、有错误与重试、0 写入；重试后 product ${before7.products}→${after7b.products}；幂等键 ${keys.length} 次一致`);

    // ---------- S8 稍后处理语义：只折叠，不写库 ----------
    await pick(convA.title);
    await card(pDefer.id).locator('[data-testid="checkin-defer"]').first().click();
    await page.waitForTimeout(1000);
    const deferredCount = await page.locator(`[data-testid="checkin-deferred"][data-decision-id="${pDefer.id}"]`).count();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    const deferredAfterReload = await page.locator(`[data-testid="checkin-deferred"][data-decision-id="${pDefer.id}"]`).count();
    const deferRow = await prisma.actionProposal.findUniqueOrThrow({ where: { id: pDefer.id } });
    await shot("09-deferred");
    must(deferredCount === 1, `稍后处理后应折叠成待办提示，实际 ${deferredCount}`);
    must(deferredAfterReload === 1, `刷新后仍应保持推迟状态，实际 ${deferredAfterReload}`);
    must(deferRow.status === "PENDING_CONFIRMATION", `推迟不改服务端状态，实际 ${deferRow.status}`);
    await page.locator(`[data-decision-id="${pDefer.id}"] [data-testid="checkin-restore"]`).first().click();
    await page.waitForTimeout(1000);
    const restored = await card(pDefer.id).locator('[data-testid="checkin-approve"]').count();
    must(restored === 1, `「继续处理」应恢复可操作卡片，实际 ${restored}`);
    record("S8", "稍后处理：折叠、刷新保持、服务端仍待确认、可恢复", "PASS",
      `推迟后折叠=${deferredCount}，刷新后=${deferredAfterReload}，状态=${deferRow.status}，恢复后按钮=${restored}`);
  } finally {
    await browser.close();
    await cleanup(org.id, [user.id]);
  }

  console.log("\n▶ 汇总");
  for (const r of results) console.log(`  ${r.id} ${r.result} — ${r.scene}`);
  console.log(`\n▶ 结果：${results.length - failures} 通过 / ${failures} 未通过（截图：${OUTPUT_DIR}）\n`);
  if (failures > 0) process.exitCode = 1;
}

async function cleanup(orgId: string, userIds: string[]) {
  const { PrismaClient } = require("@prisma/client");
  const p: any = new PrismaClient();
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      console.error(`⚠ 清理步骤 ${name} 失败：`, String(e?.message ?? e).slice(0, 160));
    }
  };
  await step("auditEvent", () =>
    p.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { objectId: { in: [...userIds, orgId] } }] } })
  );
  const models: string[] = PrismaClient.dmmf
    ? (require("@prisma/client").Prisma.dmmf.datamodel.models as any[])
        .filter((m: any) => m.fields.some((f: any) => f.kind === "scalar" && f.name === "organizationId"))
        .map((m: any) => m.name)
    : [];
  for (const m of models) {
    if (m === "Organization") continue;
    const camel = m.charAt(0).toLowerCase() + m.slice(1);
    if (!p[camel]) continue;
    await step(m, () => p[camel].deleteMany({ where: { organizationId: orgId } }));
  }
  await step("organization", () => p.organization.delete({ where: { id: orgId } }));
  console.log("🧹 已清理本次浏览器验收数据");
  await p.$disconnect();
}

main()
  .then(() => {
    if (failures > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error("\n❌ 浏览器验收失败：", error?.message ?? String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
