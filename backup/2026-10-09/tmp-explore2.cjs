const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:3100";
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const w = +(process.env.W || 1440), h = +(process.env.H || 900);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: process.env.DARK ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text().slice(0, 200)); });
  await page.goto(BASE + "/login");
  await page.fill('input[type=email]', "demo@kern.dev");
  await page.fill('input[type=password]', "KernDemo-2026");
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(BASE + "/muse" + (process.env.Q || ""));
  await page.waitForSelector(".m-dock textarea");
  await page.waitForTimeout(1500);
  const step = process.env.STEP || "top";
  if (step === "top") {
    const turns = await page.$$(".m-turn");
    const n = +(process.env.TURN || 1);
    await turns[n]?.scrollIntoViewIfNeeded();
    await page.evaluate((n) => { const t = document.querySelectorAll(".m-turn")[n]; t?.scrollIntoView({ block: "start" }); }, n);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tmp-shots/${process.env.OUT || "top"}.png` });
  }
  if (step === "open") {
    await page.click(".kxr-artifact .kxr-btn[data-v=primary]");
    const t0 = Date.now();
    await page.waitForSelector(".kxr-reader-frame", { timeout: 20000 }).catch(() => console.log("NO FRAME"));
    console.log("frame after ms", Date.now() - t0);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tmp-shots/${process.env.OUT || "reader"}.png` });
    if (process.env.CLICK) { const f = page.frameLocator(".kxr-reader-frame"); await f.locator(process.env.CLICK).first().click(); await page.waitForTimeout(800); await page.screenshot({ path: `tmp-shots/${process.env.OUT || "reader"}-click.png` }); }
  }
  if (step === "new") {
    await page.fill(".m-dock textarea", process.env.P);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tmp-shots/${process.env.OUT}-wait.png` });
    await page.waitForFunction(() => document.querySelectorAll(".m-turn:not([data-who])").length >= 1 && !document.querySelector(".m-working"), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    console.log("url", page.url());
    const shots = +(process.env.SHOTS || 3);
    await page.evaluate(() => { const t = [...document.querySelectorAll(".m-turn:not([data-who])")].pop(); t?.scrollIntoView({ block: "start" }); });
    for (let i = 0; i < shots; i++) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `tmp-shots/${process.env.OUT}-${i}.png` });
      await page.evaluate(() => document.querySelector(".m-scroll").scrollBy(0, 600));
    }
    const ov = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth, scroll: document.querySelector('.m-scroll').scrollWidth, cw: document.querySelector('.m-scroll').clientWidth }));
    console.log("overflow", JSON.stringify(ov));
  }
  if (step === "followup") {
    await page.click(".kxr-artifact .kxr-btn[data-v=primary]");
    await page.waitForTimeout(1500);
    await page.click(".kxr-chip-btn >> nth=0");
    const v = await page.inputValue(".m-dock textarea");
    console.log("prefilled:", v.slice(0, 40), "focused:", await page.evaluate(() => document.activeElement?.tagName));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tmp-shots/followup-wait.png" });
    await page.waitForFunction(() => document.querySelectorAll(".kxr-artifact").length >= 2, null, { timeout: 90000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: "tmp-shots/followup-done.png" });
    console.log("select:", await page.$eval(".kxr-select select", (el) => el.value + " | " + [...el.options].map(o => o.textContent).join(" / ")));
  }
  console.log(errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
