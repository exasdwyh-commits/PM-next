import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100";
const PROJECT = process.env.PROBE_PROJECT || "/projects/f17724ec-1393-434a-ab96-73b61e77c248";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();

const msgs = [];
page.on("pageerror", (e) => msgs.push("PAGEERROR:\n" + (e.stack || e.message)));
page.on("console", (m) => {
  if (m.type() === "error") msgs.push("CONSOLE: " + m.text());
});

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.fill('input[type="email"]', "li_vp@hermes.test");
await page.fill('input[type="password"]', "admin123");
await page.click('button[type="submit"]');
await page.waitForURL(BASE + "/", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

await page.goto(BASE + PROJECT, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

console.log("=== 错误消息（完整） ===");
console.log(msgs.join("\n\n---\n\n").slice(0, 8000) || "(无)");

console.log("\n=== 页面正文前 2000 字 ===");
console.log(String(await page.evaluate(() => document.body.innerText)).slice(0, 2000));

console.log("\n=== 结构探针 ===");
console.log(
  JSON.stringify(
    await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      tabs: document.querySelectorAll(".hermes-tabs button, [role=tab]").length,
      buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 30),
      h1: [...document.querySelectorAll("h1,h2")].map((x) => (x.textContent || "").trim()).slice(0, 8),
    })),
    null,
    2,
  ),
);

await page.screenshot({ path: "/tmp/hermes-ui-walk/probe-project-detail.png", fullPage: true });
await browser.close();
