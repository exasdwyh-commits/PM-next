// 真实浏览器取证：读取 :root 自定义属性 --ink / --line 的解析值，
// 以及 var(--line)/var(--ink) 落在具体元素上的 computed 结果。
// 用于「自引用令牌」缺陷的修前/修后对照。临时脚本（_ 前缀，不提交）。
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE || "http://127.0.0.1:3100";
const ROUTE = process.env.PROBE_ROUTE || "/login";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();

await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const raw = {
    "--ink": JSON.stringify(root.getPropertyValue("--ink")),
    "--line": JSON.stringify(root.getPropertyValue("--line")),
    "--paper": JSON.stringify(root.getPropertyValue("--paper")),
    "--bg": JSON.stringify(root.getPropertyValue("--bg")),
  };

  // 注入探针元素：border-top 用 var(--line)，color 用 var(--ink)
  const probe = document.createElement("div");
  probe.id = "__tok_probe__";
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;border-top:1px solid var(--line);color:var(--ink);";
  probe.textContent = "probe";
  document.body.appendChild(probe);
  const pcs = getComputedStyle(probe);
  const injected = {
    "border-top-color (var(--line))": pcs.borderTopColor,
    "color (var(--ink))": pcs.color,
  };

  // body 自身规则 body{color:var(--ink)}
  const bodyColor = getComputedStyle(document.body).color;

  // 页面上已有的、以 var(--line) 画边的元素
  const cand =
    document.querySelector(".hermes-login-card") ||
    document.querySelector(".hermes-card") ||
    document.querySelector(".hermes-panel") ||
    document.querySelector(".hermes-topbar") ||
    document.querySelector(".hermes-sidebar");
  let existing = null;
  if (cand) {
    const cs = getComputedStyle(cand);
    existing = {
      selector: "." + (cand.className || "").split(/\s+/).filter(Boolean).join("."),
      "border-top-color": cs.borderTopColor,
      "border-right-color": cs.borderRightColor,
      "border-bottom-color": cs.borderBottomColor,
      "border-left-color": cs.borderLeftColor,
      color: cs.color,
    };
  }

  return {
    dataPalette: document.documentElement.getAttribute("data-palette"),
    rootCustomProps: raw,
    injectedProbe: injected,
    bodyComputedColor: bodyColor,
    existingElement: existing,
  };
});

console.log(`=== 令牌探针 @ ${ROUTE} ===`);
console.log(JSON.stringify(out, null, 2));

await browser.close();
