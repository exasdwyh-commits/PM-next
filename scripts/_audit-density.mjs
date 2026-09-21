/**
 * 过程脚本（不提交）：对照参考原型与当前 hermes-next 的页面「信息密度」。
 * 用法：node scripts/_audit-density.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/hermes-density";
const APP = "http://127.0.0.1:3180";
const REF = "http://127.0.0.1:3185";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});

const PROBE = () => {
  const txt = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  const q = (s) => document.querySelectorAll(s).length;
  const cards = Array.from(document.querySelectorAll("section, article, div")).filter((el) => {
    const cs = getComputedStyle(el);
    return (
      cs.borderTopWidth !== "0px" &&
      cs.borderRadius !== "0px" &&
      el.getBoundingClientRect().height > 40 &&
      el.getBoundingClientRect().width > 150
    );
  }).length;
  return {
    textLen: txt.length,
    textHead: txt.slice(0, 160),
    h1: q("h1"),
    h2: q("h2"),
    h3: q("h3"),
    tables: q("table"),
    rows: q("tr"),
    listItems: q("li"),
    buttons: q("button"),
    links: q("a"),
    inputs: q("input,select,textarea"),
    cards,
    docHeight: document.documentElement.scrollHeight,
    mainWidth:
      (document.querySelector("main") || document.body).getBoundingClientRect().width,
  };
};

const APP_ROUTES = [
  ["home", "/"],
  ["products", "/products"],
  ["product-detail", "/products/f0c46df9-c3f9-4319-8e5e-da2411fb96fa"],
  ["projects", "/projects"],
  ["project-detail", "/projects"],
  ["advisor", "/advisor"],
  ["opportunities", "/opportunities"],
  ["knowledge", "/knowledge"],
  ["war-room", "/war-room"],
  ["consultation", "/consultation"],
  ["trace", "/trace"],
  ["dashboard", "/dashboard"],
  ["organization", "/organization"],
  ["settings", "/settings"],
];

const REF_ROUTES = [
  ["home", "/index.html"],
  ["products", "/products.html"],
  ["product-detail", "/product-detail.html"],
  ["projects", "/project-detail.html"],
  ["advisor", "/advisor.html"],
  ["opportunities", "/opportunities.html"],
  ["knowledge", "/knowledge.html"],
  ["war-room", "/war-room.html"],
  ["consultation", "/consultation.html"],
  ["trace", "/trace.html"],
  ["dashboard", "/dashboard.html"],
  ["organization", "/organization.html"],
  ["settings", "/settings.html"],
];

const rows = [];

// ---- 应用 ----
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const login = await ctx.request.post(`${APP}/api/auth/session`, {
  data: { email: "zhang_pm@hermes.test", password: "hermes-dev-2026" },
});
if (!login.ok()) {
  console.error("LOGIN FAILED", login.status(), await login.text());
  process.exit(1);
}
const page = await ctx.newPage();
for (const [name, path] of APP_ROUTES) {
  try {
    await page.goto(APP + path, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    const m = await page.evaluate(PROBE);
    rows.push({ side: "APP", name, path, ...m });
    await page.screenshot({ path: `${OUT}/app-${name}.png`, fullPage: true });
    console.log("app ", name, "textLen=", m.textLen, "h=", m.docHeight);
  } catch (e) {
    rows.push({ side: "APP", name, path, error: String(e).slice(0, 120) });
    console.log("app ", name, "ERROR", String(e).slice(0, 80));
  }
}
await ctx.close();

// ---- 参考 ----
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page2 = await ctx2.newPage();
for (const [name, path] of REF_ROUTES) {
  try {
    await page2.goto(REF + path, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page2.waitForTimeout(700);
    const m = await page2.evaluate(PROBE);
    rows.push({ side: "REF", name, path, ...m });
    await page2.screenshot({ path: `${OUT}/ref-${name}.png`, fullPage: true });
    console.log("ref ", name, "textLen=", m.textLen, "h=", m.docHeight);
  } catch (e) {
    rows.push({ side: "REF", name, path, error: String(e).slice(0, 120) });
  }
}
await ctx2.close();
await browser.close();

fs.writeFileSync(`${OUT}/rows.json`, JSON.stringify(rows, null, 2));

console.log("\n================ 对照表 ================");
console.log(
  ["page", "APP文本", "REF文本", "APP高", "REF高", "APP卡片", "REF卡片", "APP表行", "REF表行", "APP按钮", "REF按钮"].join("\t")
);
const names = [...new Set([...APP_ROUTES, ...REF_ROUTES].map(([n]) => n))];
for (const n of names) {
  const a = rows.find((r) => r.side === "APP" && r.name === n);
  const r = rows.find((x) => x.side === "REF" && x.name === n);
  const g = (o, k) => (o && o[k] != null ? o[k] : "-");
  console.log(
    [n, g(a, "textLen"), g(r, "textLen"), g(a, "docHeight"), g(r, "docHeight"), g(a, "cards"), g(r, "cards"), g(a, "rows"), g(r, "rows"), g(a, "buttons"), g(r, "buttons")].join("\t")
  );
}
console.log("done ->", OUT);
