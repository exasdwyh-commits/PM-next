/**
 * 一次性 UI 验证：真实浏览器走 /login 表单登录，追踪 API 响应与最终落地页。
 * 用法：NODE_OPTIONS= node scripts/verify-login-ui.mjs [email] [password]
 */
import { chromium } from "playwright";

const [email = "zhang_pm@hermes.test", password = "hermes1234"] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage();

const events = [];
page.on("response", (res) => {
  if (res.url().includes("/api/auth/session")) {
    events.push(`API ${res.request().method()} ${res.url()} -> ${res.status()}`);
  }
});
page.on("pageerror", (e) => events.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error") events.push(`console.error: ${m.text().slice(0, 200)}`);
});

await page.goto("http://127.0.0.1:3100/login", { waitUntil: "load", timeout: 30000 });
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.click('button[type="submit"]');

// 等登录 API 返回 + 路由跳转，最长 45s
try {
  await page.waitForURL(/127\.0\.0\.1:3100(\/)?(\?.*)?$/, { timeout: 45000, waitUntil: "load" });
  await page.waitForTimeout(3000);
} catch {
  /* 超时则记录当前状态 */
}

const alertText = await page
  .locator('[role="alert"]')
  .first()
  .textContent()
  .catch(() => null);

console.log("final url:", page.url());
console.log("alert:", alertText ?? "(none)");
console.log("events:");
for (const e of events) console.log("  -", e);
console.log("page h1:", await page.locator("h1").first().textContent().catch(() => "(none)"));
await page.screenshot({ path: "/tmp/login-verify2.png", fullPage: false });
await browser.close();
