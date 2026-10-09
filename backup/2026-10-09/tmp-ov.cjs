const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await b.newPage({ viewport: { width: +(process.env.W||1440), height: 900 } });
  await page.goto("http://127.0.0.1:3100/login");
  await page.fill("input[type=email]", "demo@kern.dev"); await page.fill("input[type=password]", "KernDemo-2026");
  await page.click("button[type=submit]"); await page.waitForURL(u => !u.pathname.startsWith("/login"));
  await page.goto("http://127.0.0.1:3100/muse?c=" + process.argv[2]); await page.waitForSelector(".kxr-rich", { timeout: 60000 }); await page.waitForTimeout(2000);
  const r = await page.evaluate(() => {
    const sc = document.querySelector(".m-scroll"); const R = sc.getBoundingClientRect().right;
    const out = []; const top = [];
    for (const el of sc.querySelectorAll("*")) { const r = el.getBoundingClientRect(); if (r.right > R + 1 && r.width > 0 && !(el.parentElement.getBoundingClientRect().right > R + 1)) top.push(el.tagName + "." + [...el.classList].join(".") + " L" + Math.round(r.left) + " W" + Math.round(r.width) + " pos " + getComputedStyle(el).position + " tf " + getComputedStyle(el).transform); if (r.right > R + 1 && r.width > 0) out.push(el.tagName + "." + [...el.classList].join(".") + " " + Math.round(r.right)); }
    const q = sc.querySelector(".m-else"); const chain = []; let e = q; while (e && e !== sc) { const r = e.getBoundingClientRect(); chain.push(e.tagName + "." + [...e.classList].join(".") + " W" + Math.round(r.width) + " T" + Math.round(r.top) + " disp " + getComputedStyle(e).display + " ov " + getComputedStyle(e).overflow); e = e.parentElement; } return { sw: sc.scrollWidth, cw: sc.clientWidth, chain };
  });
  console.log(JSON.stringify(r, null, 1)); if (process.env.SHOT) { await page.evaluate(() => document.querySelector(".m-else").closest(".m-card").scrollIntoView({block:"start"})); await page.waitForTimeout(600); await page.screenshot({ path: "tmp-shots/" + process.env.SHOT + ".png" }); } await b.close();
})();
