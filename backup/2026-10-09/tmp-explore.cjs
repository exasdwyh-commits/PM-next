const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:3100";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text().slice(0, 300)); });
  await page.goto(BASE + "/login", { timeout: 240000 });
  await page.fill('input[type=email]', "demo@kern.dev");
  await page.fill('input[type=password]', "KernDemo-2026");
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(muse|$|manage)/, { timeout: 240000 }).catch(() => {});
  console.log("after login", page.url());
  await page.goto(BASE + "/muse", { timeout: 240000 });
  await page.waitForSelector(".m-dock textarea", { timeout: 240000 });
  await page.screenshot({ path: "tmp-shots/home.png" });
  const prompt = process.argv[2];
  if (prompt) {
    await page.fill(".m-dock textarea", prompt);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "tmp-shots/sending.png" });
    await page.waitForSelector(".kxr-rich, .m-turn:not([data-who]) .m-prose", { timeout: 120000 }).catch(e => console.log("no reply", e.message));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "tmp-shots/reply.png" });
    await page.screenshot({ path: "tmp-shots/reply-full.png", fullPage: false });
  }
  console.log(errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
