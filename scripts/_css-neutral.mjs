// 行为中性证明（CSS 死类删除）：采集真实渲染 DOM 的类名集合，做 before/after 比对。
// 用法：
//   node hermes-css-neutral.mjs snapshot <out.json>
//   node hermes-css-neutral.mjs verify <old.json> <new.json> <deleted.json>
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.WALK_BASE || "http://127.0.0.1:3100";
const EMAIL = process.env.WALK_EMAIL || "li_vp@hermes.test";
const PASSWORD = process.env.WALK_PASSWORD || "admin123";

async function collect(page, url) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1300);
  return await page.evaluate(() => {
    const s = new Set();
    document.querySelectorAll("*").forEach((el) => {
      const c = el.getAttribute("class");
      if (c) c.trim().split(/\s+/).forEach((t) => t && s.add(t));
    });
    return Array.from(s).sort();
  });
}

async function main() {
  const mode = process.argv[2];
  const HOME = process.env.HOME || "";
  const exe = [
    process.env.CHROME_PATH,
    `${HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  ].find((p) => p && fs.existsSync(p));
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);

    let pid = "";
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    pid = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/products/"]');
      return a ? a.getAttribute("href") : "";
    });
    if (!pid) {
      const r = await ctx.request.get(`${BASE}/api/products`);
      if (r.ok()) {
        const j = await r.json();
        const f = (j.items || j.products || (Array.isArray(j) ? j : []))[0];
        if (f && f.id) pid = `/products/${f.id}`;
      }
    }

    const routes = ["/", "/products", pid || "/products", "/dashboard", "/trace", "/opportunities"];
    const out = {};
    for (const u of routes) {
      try {
        out[u] = await collect(page, u);
      } catch (e) {
        out[u] = ["__ERR__:" + String(e.message).slice(0, 100)];
      }
    }
    const union = Array.from(new Set(Object.values(out).flat())).sort();

    if (mode === "snapshot") {
      fs.writeFileSync(process.argv[3], JSON.stringify({ base: BASE, routes: out, union }, null, 2));
      console.log(`  snapshot → ${process.argv[3]}（routes=${routes.length}, union=${union.length}）`);
    } else if (mode === "verify") {
      const oldj = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
      const newj = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
      const deleted = JSON.parse(fs.readFileSync(process.argv[5], "utf8"));
      let identical = true;
      for (const u of Object.keys(oldj.routes)) {
        const a = oldj.routes[u].join(" ");
        const b = newj.routes[u].join(" ");
        if (a !== b) {
          identical = false;
          const sa = new Set(oldj.routes[u]);
          const sb = new Set(newj.routes[u]);
          console.log(`  ✗ route ${u} 类名集合不同`);
          console.log(`      only-old: ${[...sa].filter((x) => !sb.has(x)).join(", ") || "无"}`);
          console.log(`      only-new: ${[...sb].filter((x) => !sa.has(x)).join(", ") || "无"}`);
        }
      }
      console.log(`\n① 渲染类名集合 before==after : ${identical ? "完全一致 ✔" : "不一致 ✗"}`);
      const rendered = new Set(newj.union);
      const leaked = deleted.filter((c) => rendered.has(c));
      console.log(`② 被删的 ${deleted.length} 个类是否出现在任一渲染页面: ${leaked.length} 个 ${leaked.join(", ") || "（无 → 删除不可见 ✔）"}`);
      if (!identical || leaked.length) process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error("中性证明脚本失败:", e?.message || e);
  process.exit(1);
});
