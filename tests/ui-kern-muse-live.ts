/**
 * LIVE chain acceptance for the formal /muse (no seeding of replies):
 *   browser composer → POST /api/conversations/:id/messages → AgentRun (queued) → pm-worker
 *   → model gateway → OpenAI-compatible model → formatModelReply → KernArtifact(Version) + Message
 *   → GET read-model polling → turn.tsx RichText / artifact card / reader.
 *
 * The "model" here is scripts/mock-kern-rich-llm.cjs answering with FIXED SAMPLES — this verifies
 * the engineering chain, not model quality. Requires three running processes (see docs/kern-rich-dev-setup.md):
 *   node scripts/mock-kern-rich-llm.cjs · next (dev or start) on UI_BASE_URL · pm-worker --loops=conversation
 * Run: UI_BASE_URL=http://127.0.0.1:3100 npx tsx tests/ui-kern-muse-live.ts   (development database)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, type Page } from "playwright";
import prisma from "../src/shared/db";
import { createSession } from "../src/modules/identity/session";
const samples = require("../scripts/fixtures/kern-rich-samples.cjs") as { PROMPTS: Record<string, string> };

const base = process.env.UI_BASE_URL || "http://127.0.0.1:3100";
const MOCK = process.env.MOCK_LLM_URL || "http://127.0.0.1:3189";
const OUT = process.env.UI_SHOTS_DIR || "docs/screenshots/kern-v2-muse";
const EMAIL = process.env.KERN_DEMO_EMAIL || "zhang_pm@hermes.test";

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 10_000 }).catch(() => undefined);
}
async function noOverflow(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const sc = document.querySelector<HTMLElement>(".m-scroll");
    return { doc: document.documentElement.scrollWidth, vw: window.innerWidth, sw: sc?.scrollWidth ?? 0, cw: sc?.clientWidth ?? 0 };
  });
  assert.ok(m.doc <= m.vw + 1 && m.sw <= m.cw + 1, `${label}: horizontal overflow ${JSON.stringify(m)}`);
}

async function main() {
  const db = ((await prisma.$queryRawUnsafe(`select current_database() as d`)) as { d: string }[])[0].d;
  assert.match(db, /_dev$/, "live acceptance runs against the development database only");
  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL } });
  const token = (await createSession(user.id)).token;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--no-proxy-server"] });
  const errors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addCookies([{ name: "hermes_session_token", value: token, url: base }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (p: Page, name: string) => { await settle(p); await p.screenshot({ path: `${OUT}/${name}.png` }); };
  const composer = page.getByRole("combobox", { name: "对 Kern 说", exact: true });
  const turns = page.locator(".m-turn");

  /** Send through the real composer; observe the real waiting/working status; wait for the reply. */
  const send = async (text: string, expectText: RegExp) => {
    const before = await page.locator(".m-turn[data-author=kern], .m-turn.kern, .m-turn").count();
    await composer.fill(text);
    await composer.press("Enter");
    const status = page.locator(".m-working");
    await status.first().waitFor({ timeout: 15_000 });
    const statusText = await status.first().innerText();
    await page.getByText(expectText).last().waitFor({ timeout: 90_000 });
    await page.locator(".m-working").first().waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    return { statusText: statusText.replace(/\s+/g, " "), before };
  };

  try {
    await page.goto(`${base}/muse`);
    await composer.waitFor();
    const startedAt = new Date();

    // 1. plain question
    const s1 = await send(samples.PROMPTS.short, /SSO（单点登录）/);
    const lastTurn = () => turns.last();
    assert.equal(await lastTurn().locator(".kxr-artifact, .kxr-block").count(), 0, "plain answer: no cards");
    const conv = await prisma.conversation.findFirstOrThrow({ where: { ownerId: user.id, createdAt: { gte: startedAt } }, orderBy: { createdAt: "desc" } });
    console.log(`PASS L1 plain Q&A (status seen: "${s1.statusText}") conversation=${conv.id}`);

    // 2. product comparison → rich blocks + plan-compare v1
    await send(samples.PROMPTS.productCompare, /方案 A（自建 SaaS 订阅）更稳妥/);
    await lastTurn().locator(".kxr-compare").first().waitFor();
    await lastTurn().locator(".kxr-artifact").first().waitFor();
    const art = await prisma.kernArtifact.findFirstOrThrow({ where: { conversationId: conv.id, key: "plan-compare" } });
    assert.equal(art.currentVersion, 1);
    await noOverflow(page, "desktop v1");
    await shot(page, "desktop-rich-reply-v1");
    console.log(`PASS L2 rich reply: compare block + artifact card · KernArtifact id=${art.id} key=${art.key} v${art.currentVersion}`);

    // 3. continued edit → same artifact v2 (model saw the current artifact)
    await send(samples.PROMPTS.productCompareEdit, /已把第二个方案换成/);
    const stats = await (await fetch(`${MOCK}/__stats`)).json() as { lastContext: { artifactKeys: string[]; artifactHtmlChars: number } };
    assert.ok(stats.lastContext.artifactKeys.includes("plan-compare") && stats.lastContext.artifactHtmlChars > 1000, `model received current artifact: ${JSON.stringify(stats.lastContext)}`);
    const art2 = await prisma.kernArtifact.findUniqueOrThrow({ where: { id: art.id } });
    assert.equal(art2.currentVersion, 2);
    assert.equal(await prisma.kernArtifact.count({ where: { conversationId: conv.id } }), 1);
    const cards = page.locator(".kxr-artifact");
    await cards.first().getByRole("button", { name: "已更新到 v2" }).waitFor();
    await shot(page, "desktop-rich-reply-v2");
    // open v1 from the older card, then switch to v2 in the reader
    await cards.first().getByRole("button", { name: /^打开/ }).click();
    const reader = page.locator(".kxr-reader");
    const frame = page.frameLocator("iframe.kxr-reader-frame");
    await frame.locator("text=方案 B · 大客户私有化部署").first().waitFor();
    await shot(page, "desktop-reader-v1");
    await reader.locator(".kxr-select select").selectOption("2");
    await frame.locator("text=风险（已突出）").first().waitFor();
    await shot(page, "desktop-reader-v2");
    console.log(`PASS L3 '突出风险，把第二个方案换掉' → same artifact v2; v1 viewable; model context keys=${stats.lastContext.artifactKeys.join(",")} html=${stats.lastContext.artifactHtmlChars}ch`);

    // 7. offline export of v2 (owner download route)
    const download = page.waitForEvent("download");
    await reader.getByRole("link", { name: /下载离线版/ }).click();
    const html = fs.readFileSync((await (await download).path())!, "utf8");
    assert.match(html, /Content-Security-Policy/);
    assert.ok(html.includes("方案 C · 渠道代理分销"));
    const exportPath = `${OUT}/plan-compare-v2.mock-chain.html`;
    fs.writeFileSync(exportPath, html);
    await page.keyboard.press("Escape");
    await reader.waitFor({ state: "detached" });
    console.log(`PASS L7 offline export → ${exportPath}`);

    // 6. failure on the same artifact: prose kept, FAILED, READY v2 intact; retry → v4, no junk
    await send("[mock:artifact-fail:plan-compare] 再出一版", /已把第二个方案换成/);
    const retry = lastTurn().getByRole("button", { name: "重新生成" });
    await retry.waitFor();
    const afterFail = await prisma.kernArtifact.findUniqueOrThrow({ where: { id: art.id }, include: { versions: { orderBy: { version: "asc" } } } });
    assert.equal(afterFail.currentVersion, 2);
    assert.deepEqual(afterFail.versions.map((v) => `${v.version}:${v.status}`), ["1:READY", "2:READY", "3:FAILED"]);
    await shot(page, "desktop-failed");
    await retry.click();
    await retry.click({ timeout: 1500 }).catch(() => undefined);
    await page.locator(".m-working").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForFunction(async () => true);
    for (let i = 0; i < 60; i++) {
      const a = await prisma.kernArtifact.findUniqueOrThrow({ where: { id: art.id } });
      if (a.currentVersion === 4) break;
      await page.waitForTimeout(1000);
    }
    const afterRetry = await prisma.kernArtifact.findUniqueOrThrow({ where: { id: art.id }, include: { versions: { orderBy: { version: "asc" } } } });
    assert.deepEqual(afterRetry.versions.map((v) => `${v.version}:${v.status}`), ["1:READY", "2:READY", "3:FAILED", "4:READY"]);
    assert.equal(await prisma.message.count({ where: { conversationId: conv.id, role: "USER", content: { contains: "请重新生成可视化成果" } } }), 1, "double-click retry sends once");
    console.log("PASS L6 failure: prose kept, v3 FAILED, current stays v2; retry (double-click) → one request → v4 READY");

    // 5. refresh / reopen restores everything
    await page.goto(`${base}/muse?c=${conv.id}`);
    await page.locator(".kxr-artifact").nth(3).waitFor({ timeout: 30_000 });
    assert.equal(await page.locator(".kxr-compare").count() >= 2, true);
    assert.ok(await page.getByText("SSO（单点登录）").count() >= 1);
    await noOverflow(page, "desktop after reload");
    await shot(page, "desktop-after-reload");
    console.log("PASS L5 refresh: plain answer, rich blocks, 4 artifact cards (v1, v2, FAILED v3, v4) restored");

    // 9. responsive / dark
    for (const v of [{ w: 390, h: 844, dark: false, n: "mobile-muse-light" }, { w: 390, h: 844, dark: true, n: "mobile-muse-dark" }, { w: 1440, h: 900, dark: true, n: "desktop-muse-dark" }]) {
      const c = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: v.dark ? "dark" : "light" });
      await c.addCookies([{ name: "hermes_session_token", value: token, url: base }]);
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(`${base}/muse?c=${conv.id}`);
      await p.locator(".kxr-artifact").nth(3).waitFor({ timeout: 30_000 });
      await noOverflow(p, v.n);
      if (v.w === 390) {
        // input must not cover the last message
        const dock = await p.locator(".m-dock").boundingBox();
        await p.locator(".m-scroll").evaluate((e) => { e.scrollTop = e.scrollHeight; });
        await p.waitForTimeout(400);
        const last = await p.locator(".m-turn").last().boundingBox();
        assert.ok(dock && last && last.y + last.height <= dock.y + 2, `${v.n}: composer covers the last message`);
        if (!v.dark) {
          await p.locator(".kxr-artifact").last().getByRole("button", { name: /^打开/ }).click();
          const r = p.locator(".kxr-reader");
          await r.locator("iframe.kxr-reader-frame").waitFor();
          const rb = await r.boundingBox();
          assert.ok(rb && rb.width >= 389, "mobile reader fullscreen");
          await shot(p, "mobile-reader-v4");
          await r.getByRole("button", { name: /返回对话/ }).click();
        }
      }
      await shot(p, v.n);
      await c.close();
    }
    console.log("PASS L9 390 light/dark + 1440 dark: no horizontal overflow, composer clear of messages, mobile fullscreen reader");

    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    console.log(`PASS no page errors · screenshots → ${OUT}`);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
