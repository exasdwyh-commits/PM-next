/**
 * Browser acceptance — Kern rich replies + HTML artifacts in the real /muse.
 *
 * Data: FIXED SAMPLES (scripts/fixtures/kern-rich-samples.cjs) are pushed through the same
 * production pipeline the conversation engine uses (formatModelReply → persistReplyArtifacts),
 * into the isolated test database. No model is called; the live worker → model chain is covered
 * separately by running /muse against scripts/mock-kern-rich-llm.cjs.
 *
 * Run (production build + isolated server):
 *   node scripts/run-sh.js scripts/acc-server.sh --port 3236 3237 tests/ui-kern-rich-artifacts.ts
 * Optional: CHROME_PATH=/path/to/chrome (defaults to Playwright's bundled Chromium).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createSession } from "../src/modules/identity/session";
import { formatModelReply } from "../src/modules/assistant-runtime/conversation-engine";
import { persistReplyArtifacts } from "../src/modules/artifacts/service";
import { ARTIFACT_CHANNEL } from "../src/modules/artifacts/protocol";
const samples = require("../scripts/fixtures/kern-rich-samples.cjs") as {
  PROMPTS: Record<"compare" | "compareEdit" | "cost" | "plan" | "short", string>;
  reply: (kind: string) => string;
};

const base = process.env.UI_BASE_URL!;
const OUT = process.env.UI_SHOTS_DIR || "docs/screenshots/kern-rich";

type Seeded = { orgId: string; userId: string; agentId: string };

async function seedTurn(s: Seeded, conversationId: string, prompt: string, raw: string) {
  await prisma.message.create({ data: { conversationId, role: "USER", content: prompt } });
  const { reply, artifacts } = formatModelReply(raw);
  return prisma.$transaction(async (tx) => {
    const id = crypto.randomUUID();
    const persisted = await persistReplyArtifacts(tx, {
      organizationId: s.orgId, ownerId: s.userId, conversationId, messageId: id, runId: null,
      content: reply.text, artifacts,
    });
    return tx.message.create({ data: { id, conversationId, role: "ASSISTANT", content: persisted.content, citations: JSON.parse(JSON.stringify(persisted.citations)) } });
  });
}

async function conversation(s: Seeded, title: string) {
  return prisma.conversation.create({ data: { organizationId: s.orgId, ownerId: s.userId, title } });
}

async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 10_000 }).catch(() => undefined);
}

async function noHorizontalOverflow(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const sc = document.querySelector<HTMLElement>(".m-scroll");
    return { doc: document.documentElement.scrollWidth, vw: window.innerWidth, sw: sc?.scrollWidth ?? 0, cw: sc?.clientWidth ?? 0 };
  });
  assert.ok(m.doc <= m.vw + 1, `${label}: page overflows horizontally (${m.doc} > ${m.vw})`);
  assert.ok(m.sw <= m.cw + 1, `${label}: conversation overflows horizontally (${m.sw} > ${m.cw})`);
}

async function main() {
  await assertTestDatabaseSafety();
  const tag = `kern-rich-${Date.now()}`;
  const org = await prisma.organization.create({ data: { code: tag, name: "Kern 富回复验收" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "富回复验收", email: `${tag}@test.local` } });
  const other = await prisma.user.create({ data: { organizationId: org.id, name: "旁观者", email: `${tag}-other@test.local` } });
  const agent = await prisma.agent.create({ data: { organizationId: org.id, code: "hermes_pm", name: "Kern", roleKey: "hermes_pm", ownerId: user.id } });
  const s: Seeded = { orgId: org.id, userId: user.id, agentId: agent.id };

  const compare = await conversation(s, "协作工具套餐对比（固定样例）");
  const v1Msg = await seedTurn(s, compare.id, samples.PROMPTS.compare, samples.reply("compare"));
  const v2Msg = await seedTurn(s, compare.id, samples.PROMPTS.compareEdit, samples.reply("compareEdit"));
  const cost = await conversation(s, "拿铁成本（固定样例）");
  await seedTurn(s, cost.id, samples.PROMPTS.cost, samples.reply("cost"));
  const plan = await conversation(s, "官网改版排期（固定样例）");
  await seedTurn(s, plan.id, samples.PROMPTS.plan, samples.reply("plan"));
  const short = await conversation(s, "SSO（固定样例）");
  await seedTurn(s, short.id, samples.PROMPTS.short, samples.reply("short"));
  const failed = await conversation(s, "生成中断（固定样例）");
  await seedTurn(s, failed.id, "[mock:artifact-fail] 把方案对比做成可视化页面", samples.reply("fail"));

  const artifact = await prisma.kernArtifact.findFirstOrThrow({ where: { conversationId: compare.id, key: "plan-compare" }, include: { versions: { orderBy: { version: "asc" } } } });
  assert.equal(artifact.currentVersion, 2, "follow-up with the same key must create v2 of the same artifact");
  assert.deepEqual(artifact.versions.map((v) => [v.version, v.status, v.messageId]), [[1, "READY", v1Msg.id], [2, "READY", v2Msg.id]]);
  assert.match(artifact.versions[1].html, /数据导出/);
  assert.doesNotMatch(v1Msg.content, /<html|<script/i, "artifact HTML must never be stored in message text");
  const failedArtifact = await prisma.kernArtifact.findFirstOrThrow({ where: { conversationId: failed.id }, include: { versions: true } });
  assert.equal(failedArtifact.currentVersion, 0);
  assert.equal(failedArtifact.versions[0].status, "FAILED");
  console.log("PASS pipeline: same key → v1/v2 linked to their messages; truncated HTML → FAILED, text kept");

  const token = (await createSession(user.id)).token;
  const otherToken = (await createSession(other.id)).token;
  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox", "--no-proxy-server"] });
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  const open = async (opts: { width: number; height: number; dark?: boolean; reduced?: boolean }) => {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: opts.width, height: opts.height }, colorScheme: opts.dark ? "dark" : "light",
      reducedMotion: opts.reduced ? "reduce" : "no-preference", acceptDownloads: true,
    });
    await context.addCookies([{ name: "hermes_session_token", value: token, url: base }]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return { context, page };
  };
  const shot = async (page: Page, name: string) => { await settle(page); await page.screenshot({ path: `${OUT}/${name}.png` }); };

  try {
    // ───────── desktop: rich reply → preview → reader → interact → versions → isolation ─────────
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.goto(`${base}/muse?c=${compare.id}`);
    const cards = page.locator(".kxr-artifact");
    await cards.nth(1).waitFor();
    assert.equal(await cards.count(), 2);
    const firstTurn = page.locator(".kxr-rich").first();
    assert.match(await firstTurn.innerText(), /6 人团队优先考虑方案 A/);
    assert.equal(await firstTurn.locator(".kxr-compare").count(), 1, "comparison renders as a compare block");
    assert.ok(await firstTurn.locator("[data-unknown]").count() >= 1, "unknown values are marked, not shown as numbers");
    assert.equal(await page.locator(".kxr-artifact-thumb").first().getAttribute("sandbox"), "allow-scripts");
    await noHorizontalOverflow(page, "desktop compare");
    console.log("PASS rich reply: conclusion, compare block, unknown cells marked, sandboxed thumbnail");

    // Older card knows a newer version exists; opening it pins v1.
    await cards.nth(0).getByRole("button", { name: "已更新到 v2" }).waitFor();
    const openV1 = cards.nth(0).getByRole("button", { name: /^打开/ });
    await openV1.click();
    const reader = page.locator(".kxr-reader");
    await reader.waitFor();
    const versionSelect = reader.locator(".kxr-select select");
    assert.equal(await versionSelect.inputValue(), "1");
    assert.deepEqual(await versionSelect.locator("option").allInnerTexts().then((o) => o.map((t) => t.split(" · ")[0])), ["v2", "v1"]);
    const frameEl = reader.locator("iframe.kxr-reader-frame");
    await frameEl.waitFor();
    assert.equal(await frameEl.getAttribute("sandbox"), "allow-scripts", "reader iframe must not get allow-same-origin");
    const frame = page.frameLocator("iframe.kxr-reader-frame");
    await frame.locator("[data-pick=a]").click();
    assert.equal(await frame.locator("[data-pick=a]").getAttribute("aria-pressed"), "true", "light JS interaction runs inside the sandbox");
    assert.equal(await frame.locator("text=数据导出").count(), 0, "v1 does not contain the follow-up edit");
    await shot(page, "desktop-reader-v1-light");
    await versionSelect.selectOption("2");
    await frame.locator("text=数据导出").first().waitFor();
    console.log("PASS reader: pinned v1 → interaction in sandbox → switch to v2 via version history");

    // Isolation probes from inside the artifact document.
    const handle = await frameEl.elementHandle();
    const inner = await handle!.contentFrame();
    const probe = await inner!.evaluate(async () => {
      const r: Record<string, string> = {};
      try { r.cookie = `READ:${document.cookie}`; } catch (e) { r.cookie = `BLOCKED:${(e as Error).name}`; }
      try { r.storage = `READ:${String(window.localStorage.length)}`; } catch (e) { r.storage = `BLOCKED:${(e as Error).name}`; }
      try { await fetch("/api/conversations"); r.fetch = "READ"; } catch (e) { r.fetch = `BLOCKED:${(e as Error).name}`; }
      try { r.parent = `READ:${String(window.parent.document.title)}`; } catch (e) { r.parent = `BLOCKED:${(e as Error).name}`; }
      r.origin = String(window.origin);
      return r;
    });
    assert.match(probe.cookie, /^BLOCKED/, `cookie must be unreachable (${probe.cookie})`);
    assert.match(probe.storage, /^BLOCKED/, `storage must be unreachable (${probe.storage})`);
    assert.match(probe.fetch, /^BLOCKED/, `network must be blocked (${probe.fetch})`);
    assert.match(probe.parent, /^BLOCKED/, `host DOM must be unreachable (${probe.parent})`);
    assert.equal(probe.origin, "null");
    console.log("PASS isolation: opaque origin; cookie/storage/fetch/parent DOM all blocked", JSON.stringify(probe));

    // Bridge: forged messages are ignored; a real "ask" only prefills the composer (never sends).
    const composer = page.getByRole("combobox", { name: "对 Kern 说", exact: true });
    await composer.fill("");
    await page.evaluate(({ channel, id }) => {
      window.postMessage({ channel, type: "ask", artifactId: id, nonce: "forged", text: "伪造的提问" }, "*");
    }, { channel: ARTIFACT_CHANNEL, id: artifact.id });
    await inner!.evaluate(({ channel, id }) => {
      window.parent.postMessage({ channel, type: "ask", artifactId: id, nonce: "guessed", text: "猜测 nonce 的提问" }, "*");
    }, { channel: ARTIFACT_CHANNEL, id: artifact.id });
    await page.waitForTimeout(400);
    assert.equal(await composer.inputValue(), "", "forged / wrong-nonce messages must be ignored");
    const before = await prisma.message.count({ where: { conversationId: compare.id } });
    await frame.locator("button.ask").click();
    await page.waitForFunction(() => /第 6 个席位/.test(document.querySelector<HTMLTextAreaElement>(".m-dock textarea")?.value ?? ""));
    await page.waitForTimeout(600);
    assert.equal(await prisma.message.count({ where: { conversationId: compare.id } }), before, "ask from an artifact must not send anything by itself");
    await composer.fill("");
    console.log("PASS bridge: forged + wrong-nonce messages ignored; artifact ask prefills composer only");

    // Download: standalone offline HTML, owner-only.
    const download = page.waitForEvent("download");
    await reader.getByRole("link", { name: /下载离线版/ }).click();
    const file = await (await download).path();
    const html = fs.readFileSync(file!, "utf8");
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /数据导出/);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=["']https?:/i, "offline file must not depend on the network");
    fs.writeFileSync(`${OUT}/sample-compare-v2.固定样例.html`, html);
    const res = await page.request.get(`${base}/api/artifacts/${artifact.id}/versions/2/download`);
    assert.equal(res.status(), 200);
    assert.match(res.headers()["content-disposition"] ?? "", /attachment/);
    const stranger = await browser.newContext();
    await stranger.addCookies([{ name: "hermes_session_token", value: otherToken, url: base }]);
    for (const path of [`/api/artifacts/${artifact.id}`, `/api/artifacts/${artifact.id}/versions/1`, `/api/artifacts/${artifact.id}/versions/1/download`]) {
      assert.equal((await stranger.request.get(`${base}${path}`)).status(), 404, `${path} must be owner-only`);
    }
    await stranger.close();
    console.log("PASS export: offline HTML with CSP, no external deps; other users get 404");

    // Close returns focus; refresh restores everything.
    await page.keyboard.press("Escape");
    await reader.waitFor({ state: "detached" });
    await page.waitForFunction(() => /打开/.test(document.activeElement?.textContent ?? ""));
    await page.reload();
    await cards.nth(1).waitFor();
    assert.equal(await cards.count(), 2);
    assert.match(await page.locator(".kxr-rich").last().innerText(), /数据导出/);
    await shot(page, "desktop-compare-light");
    console.log("PASS close → focus returns to opener; refresh restores both versions and text");

    // Other samples render with their own composition; short answer stays light.
    for (const [c, name, expect] of [[cost, "cost", ".kxr-metrics"], [plan, "plan", ".kxr-tl"], [short, "short", null]] as const) {
      await page.goto(`${base}/muse?c=${c.id}`);
      await page.locator(".m-turn").last().waitFor();
      await page.waitForTimeout(800);
      if (expect) {
        await page.locator(expect).first().waitFor();
        assert.equal(await page.locator(".kxr-artifact").count(), 1, `${name} has one artifact`);
      } else {
        await page.getByText("SSO（单点登录）").first().waitFor();
        assert.equal(await page.locator(".kxr-artifact, .kxr-block").count(), 0, "short answer must not be over-packaged");
      }
      await noHorizontalOverflow(page, name);
      await shot(page, `desktop-${name}-light`);
    }
    // Export the other two samples as offline files for delivery.
    for (const key of ["latte-cost", "site-revamp-plan"]) {
      const a = await prisma.kernArtifact.findFirstOrThrow({ where: { ownerId: user.id, key } });
      const r = await page.request.get(`${base}/api/artifacts/${a.id}/versions/${a.currentVersion}/download`);
      assert.equal(r.status(), 200);
      fs.writeFileSync(`${OUT}/sample-${key}-v${a.currentVersion}.固定样例.html`, await r.text());
    }
    console.log("PASS cost / plan compositions + short answer stays plain; samples exported");

    // Failure keeps text + retry sends exactly one request.
    await page.goto(`${base}/muse?c=${failed.id}`);
    const retry = page.getByRole("button", { name: "重新生成" });
    await retry.waitFor();
    assert.match(await page.locator(".m-turn").last().innerText(), /我先给出对比结论/);
    await shot(page, "desktop-failed-light");
    await retry.click();
    await retry.click({ timeout: 1500 }).catch(() => undefined);
    await page.getByRole("button", { name: "已发送重新生成请求" }).waitFor();
    await page.waitForTimeout(800);
    assert.equal(await prisma.message.count({ where: { conversationId: failed.id, role: "USER", content: { contains: "请重新生成可视化成果" } } }), 1, "retry must not duplicate");
    console.log("PASS failure: text kept, FAILED card, retry sends one request");
    await context.close();

    // ───────── dark + tablet + mobile ─────────
    {
      const { context: c, page: p } = await open({ width: 1440, height: 900, dark: true });
      await p.goto(`${base}/muse?c=${cost.id}`);
      await p.locator(".kxr-metrics").first().waitFor();
      await shot(p, "desktop-cost-dark");
      await p.locator(".kxr-artifact").getByRole("button", { name: /^打开/ }).click();
      await p.locator("iframe.kxr-reader-frame").waitFor();
      await p.waitForTimeout(800);
      await shot(p, "desktop-reader-cost-dark");
      await c.close();
    }
    {
      const { context: c, page: p } = await open({ width: 768, height: 1024 });
      await p.goto(`${base}/muse?c=${plan.id}`);
      await p.locator(".kxr-tl").first().waitFor();
      await noHorizontalOverflow(p, "768 plan");
      await shot(p, "tablet-plan-light");
      await c.close();
    }
    {
      const { context: c, page: p } = await open({ width: 390, height: 844 });
      await p.goto(`${base}/muse?c=${compare.id}`);
      const card = p.locator(".kxr-artifact").nth(1);
      await card.waitFor();
      await noHorizontalOverflow(p, "390 compare");
      await card.scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      const top = await p.locator(".m-scroll").evaluate((e) => e.scrollTop);
      const btn = card.getByRole("button", { name: /^打开/ });
      const box = await btn.boundingBox();
      assert.ok(box && box.height >= 44, "mobile touch target ≥ 44px");
      await btn.click();
      const r = p.locator(".kxr-reader");
      await r.locator("iframe.kxr-reader-frame").waitFor();
      const rb = await r.boundingBox();
      assert.ok(rb && rb.width >= 389 && rb.x <= 1, "reader is fullscreen on mobile");
      await shot(p, "mobile-reader-light");
      await r.getByRole("button", { name: /返回对话/ }).click();
      await r.waitFor({ state: "detached" });
      const after = await p.locator(".m-scroll").evaluate((e) => e.scrollTop);
      assert.ok(Math.abs(after - top) <= 4, `returning keeps the reading position (${top} → ${after})`);
      await shot(p, "mobile-compare-light");
      await c.close();
    }
    {
      const { context: c, page: p } = await open({ width: 390, height: 844, dark: true });
      await p.goto(`${base}/muse?c=${plan.id}`);
      await p.locator(".kxr-tl").first().waitFor();
      await noHorizontalOverflow(p, "390 plan dark");
      await shot(p, "mobile-plan-dark");
      await c.close();
    }
    console.log("PASS dark / 768 / 390: no horizontal overflow, fullscreen reader, ≥44px target, scroll position kept");

    // ───────── reduced motion ─────────
    {
      const { context: c, page: p } = await open({ width: 1440, height: 900, reduced: true });
      await p.goto(`${base}/muse?c=${cost.id}`);
      await p.locator(".kxr-metrics").first().waitFor();
      await p.waitForTimeout(200);
      const moving = await p.evaluate(() => document.getAnimations().filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return a.playState === "running" && !!t?.closest(".kxr-rich, .kxr-reader, .kxr-artifact");
      }).length);
      assert.equal(moving, 0, "prefers-reduced-motion stops rich-reply animations");
      await c.close();
    }
    console.log("PASS reduced motion: no running rich-reply animations");

    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    console.log(`PASS no page errors · screenshots → ${OUT}`);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
