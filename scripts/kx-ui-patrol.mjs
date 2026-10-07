#!/usr/bin/env node
/**
 * KX-02 UI 巡检：遍历全部页面 × 3 种宽度 × 深浅色，采集运行时问题。
 *
 * 用法（先启动 `npm run dev`，默认 http://localhost:3100）：
 *   node scripts/kx-ui-patrol.mjs [--base http://localhost:3100] [--out /tmp/kx-patrol] [--only /muse,/products]
 *
 * 采集项：页面异常、控制台错误、hydration 警告、4xx/5xx 与失败请求、横向溢出、
 * 超出视口的可见元素、没有可访问名称的按钮；每个组合一张视口截图。
 * 口令只从环境变量 DEV_LOGIN_PASSWORD / SEED_PASSWORD 或本机 .env 读取，不打印、不落盘。
 * 退出码：出现页面异常或 5xx 时为 1，否则为 0。
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg("--base", process.env.PATROL_BASE ?? "http://localhost:3100");
const OUT = arg("--out", process.env.PATROL_OUT ?? "/tmp/kx-patrol");
const ONLY = arg("--only", "").split(",").filter(Boolean);
const EMAIL = process.env.PATROL_EMAIL ?? "zhang_pm@hermes.test";

function readPassword() {
  if (process.env.DEV_LOGIN_PASSWORD) return process.env.DEV_LOGIN_PASSWORD;
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  try {
    const line = fs
      .readFileSync(path.join(process.cwd(), ".env"), "utf8")
      .split(/\r?\n/)
      .find((l) => /^SEED_PASSWORD=/.test(l));
    if (line) return line.slice("SEED_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
  } catch {
    /* 没有 .env 时走下面的报错 */
  }
  throw new Error("缺少开发口令：请设置 DEV_LOGIN_PASSWORD 或 SEED_PASSWORD（口令不写进仓库）");
}

const STATIC_ROUTES = [
  "/", "/muse", "/dashboard", "/advisor", "/consultation", "/knowledge", "/manage",
  "/opportunities", "/organization", "/products", "/projects", "/settings", "/trace",
  "/war-room", "/workforce",
];
const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "1024", width: 1024, height: 768 },
  { tag: "390", width: 390, height: 844 },
];
const SCHEMES = ["light", "dark"];

const slug = (r) => (r === "/" ? "root" : r.replace(/^\//, "").replace(/[/?=&]+/g, "_"));

async function login(ctx, password) {
  const res = await ctx.request.post(`${BASE}/api/auth/session`, { data: { email: EMAIL, password } });
  if (!res.ok()) throw new Error(`登录失败：HTTP ${res.status()}`);
}

async function resolveDynamic(page) {
  const found = [];
  for (const [list, prefix] of [["/products", "/products/"], ["/projects", "/projects/"]]) {
    try {
      await page.goto(`${BASE}${list}`, { waitUntil: "networkidle", timeout: 60000 });
      const href = await page.evaluate((p) => {
        const a = [...document.querySelectorAll("a[href]")].find((x) => {
          const h = x.getAttribute("href") || "";
          return h.startsWith(p) && h.length > p.length && !h.includes("new");
        });
        return a ? a.getAttribute("href") : null;
      }, prefix);
      if (href) found.push(href.split("#")[0]);
    } catch {
      /* 列表页打不开时，动态页由列表页那条记录暴露问题 */
    }
  }
  return found;
}

async function inspect(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflowX = document.documentElement.scrollWidth - vw;
    const outside = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.position === "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 2 && r.left < vw) {
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "hidden" || o === "auto" || o === "scroll" || o === "clip") { clipped = true; break; }
        }
        if (!clipped && el.children.length === 0) {
          outside.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}:${(el.textContent || "").trim().slice(0, 24)}`);
        }
      }
    }
    const unnamed = [];
    for (const b of document.querySelectorAll("button, [role=button]")) {
      const name = (b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "").trim();
      const labelledby = b.getAttribute("aria-labelledby");
      if (!name && !labelledby) unnamed.push(b.outerHTML.slice(0, 90));
    }
    return { overflowX, outside: outside.slice(0, 8), unnamed: unnamed.slice(0, 8), title: document.title };
  });
}

const password = readPassword();
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];

try {
  const probe = await browser.newContext();
  await login(probe, password);
  const probePage = await probe.newPage();
  const dynamic = await resolveDynamic(probePage);
  await probe.close();

  let routes = [...STATIC_ROUTES, ...dynamic];
  if (ONLY.length) routes = routes.filter((r) => ONLY.some((o) => r.startsWith(o)));
  const plan = [{ route: "/login", auth: false }, ...routes.map((route) => ({ route, auth: true }))];

  for (const scheme of SCHEMES) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: vp, locale: "zh-CN", colorScheme: scheme, deviceScaleFactor: 1 });
      const anon = await browser.newContext({ viewport: vp, locale: "zh-CN", colorScheme: scheme, deviceScaleFactor: 1 });
      await login(ctx, password);
      for (const item of plan) {
        const page = await (item.auth ? ctx : anon).newPage();
        const rec = { route: item.route, vp: vp.tag, scheme, pageErrors: [], consoleErrors: [], hydration: [], badResponses: [], failed: [] };
        page.on("pageerror", (e) => rec.pageErrors.push(e.message.slice(0, 300)));
        page.on("console", (m) => {
          const t = m.text();
          if (/hydrat|did not match|server rendered HTML/i.test(t)) rec.hydration.push(t.slice(0, 300));
          else if (m.type() === "error") rec.consoleErrors.push(t.slice(0, 300));
        });
        page.on("response", (r) => {
          if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) rec.badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`.slice(0, 200));
        });
        page.on("requestfailed", (r) => {
          const why = r.failure()?.errorText ?? "";
          if (!/ERR_ABORTED/.test(why)) rec.failed.push(`${why} ${r.url().replace(BASE, "")}`.slice(0, 200));
        });
        const t0 = Date.now();
        try {
          const resp = await page.goto(`${BASE}${item.route}`, { waitUntil: "networkidle", timeout: 90000 });
          rec.status = resp ? resp.status() : null;
          rec.finalUrl = page.url().replace(BASE, "");
          await page.waitForTimeout(700);
          Object.assign(rec, await inspect(page));
          await page.screenshot({ path: path.join(OUT, `${slug(item.route)}-${vp.tag}-${scheme}.png`) });
        } catch (e) {
          rec.navError = String(e.message || e).slice(0, 300);
        }
        rec.ms = Date.now() - t0;
        results.push(rec);
        const flags = [
          rec.navError && "NAV",
          rec.pageErrors.length && `PAGEERR×${rec.pageErrors.length}`,
          rec.hydration.length && `HYDR×${rec.hydration.length}`,
          rec.consoleErrors.length && `CONSOLE×${rec.consoleErrors.length}`,
          rec.badResponses.length && `HTTP×${rec.badResponses.length}`,
          rec.overflowX > 1 && `OVERFLOW+${rec.overflowX}px`,
          rec.outside?.length && `OUTSIDE×${rec.outside.length}`,
          rec.unnamed?.length && `NONAME×${rec.unnamed.length}`,
        ].filter(Boolean);
        console.log(`${flags.length ? "⚠" : "✓"} ${item.route} ${vp.tag} ${scheme} ${rec.ms}ms ${flags.join(" ")}`);
        await page.close();
      }
      await ctx.close();
      await anon.close();
    }
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.pageErrors.length || r.badResponses.some((s) => s.startsWith("5")) || r.navError);
console.log(`\n巡检完成：${results.length} 个组合，严重问题 ${bad.length} 个。报告：${path.join(OUT, "report.json")}`);
process.exit(bad.length ? 1 : 0);
