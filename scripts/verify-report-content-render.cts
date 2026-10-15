/** Browser proof of the real ReportV3 template. No DB or real model; never label this as a research deliverable. */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { buildMissionPoster } from "../src/modules/supervisor/report-poster";
import { produceReportContent, type ReportContentStore } from "../src/modules/supervisor/report-content-agent";
import type { MissionReport } from "../src/modules/supervisor/report-format";
import type { ReportContentDocument } from "../src/shared/report-content";

async function main() {
  // Static rendering needs no CSS loader; use the actual stylesheet below, not an imitation.
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  require.extensions[".css"] = () => {};
  const { ReportV3 } = require("../src/components/report-v3");
  const report: MissionReport = {
    playbook: "NEW_PRODUCT", missionTaskId: "render-fixture", title: "研究报告", goal: "我想开发一个新产品：便携咖啡机，面向通勤白领",
    status: "SUCCEEDED", outcome: "COMPLETED", demo: false, createdAt: "2026-10-15T00:00:00Z", constraints: [],
    conclusion: "## 结论摘要\n先验证便携咖啡机的通勤需求（推断）。\n## 产品定位\n面向通勤白领，使用场景仍需访谈验证。\n## 风险评估\n- 成本尚无报价，不能据此定价。\n- 电池寿命与清洗便利性尚未测试。\n## 验证计划与待决策\nUNKNOWN：电池寿命（需要样机测试）\n是否先开展样机测试。\n先访谈通勤用户，再决定是否立项。\n## 来源说明\n本页是模板回归夹具，不包含真实市场调研资料。",
    originalConclusion: "## 风险评估\n- 编辑前识别的清洗风险不能丢失。\nUNKNOWN：用户需求（需要通勤访谈）",
    decision: null, recommendation: null, steps: [], researchSources: [],
    meta: { tasksCreated: 1, maxTasks: 1, memoriesUsed: [], successCriteria: [], humanGates: [] },
  };
  const summary = "先验证便携咖啡机的通勤需求（推断）。";
  let document: ReportContentDocument | null = null;
  const store: ReportContentStore = { read: async () => document && structuredClone(document), write: async next => { document = structuredClone(next); } };
  let calls = 0;
  const content = await produceReportContent({ report, nodeTaskId: "render-node", store,
    call: async () => ({ text: JSON.stringify(++calls === 1
      ? { subject: "便携咖啡机", title: "新产品：便携咖啡机", summary, risks: ["成本尚无报价，不能据此定价。", "电池寿命与清洗便利性尚未测试。"], unknowns: ["UNKNOWN：电池寿命（需要样机测试）"], decisions: ["是否先开展样机测试。"], actions: ["先访谈通勤用户，再决定是否立项。"] }
      : { topicMatch: true, goalQuote: "新产品：便携咖啡机", bodyQuote: summary, title: "便携咖啡机", summary, note: "渲染夹具审校，不是模型实测或事实核验。", layout: { density: "compact", summaryLines: 3 } }) }),
  });
  if (content.status !== "READY") throw new Error(`Fixture content failed: ${content.note}`);
  const poster = buildMissionPoster({ ...report, content, contentStatus: content.status });
  const css = fs.readFileSync("src/components/report-v3.css", "utf8");
  const markup = renderToStaticMarkup(React.createElement(ReportV3, { report: poster, embedded: true }));
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>便携咖啡机 · 模板渲染回归样例</title><style>body{margin:0;background:#f6f4ef;color:#182723;font-family:system-ui,"Microsoft YaHei",sans-serif}a{color:inherit}.fixture-note{padding:14px 24px;border-bottom:1px solid #a8b7ad;background:#edf4ec;color:#182723;font-size:14px}${css}</style><body><aside class="fixture-note">模板渲染回归样例 · 使用真实 ReportV3 组件，模型和存储均为测试替身 · 非真实研究成品</aside>${markup}</body></html>`;
  const dir = path.resolve("verification/report-content"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "coffee-template-preview.html"), html.replace(/></g, ">\n<"));
  fs.writeFileSync(path.join(dir, "coffee-template-data.json"), JSON.stringify({ fixture: true, content, poster }, null, 2));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
  const results: { viewport: string; title: string | null; density: string | null; summaryLines: string; overflow: boolean }[] = [];
  try {
    for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]] as const) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const title = await page.locator("h1").textContent();
      if ((await page.locator(".gap-grid").textContent())?.includes("UNKNOWN")) throw new Error("Raw UNKNOWN leaked into gap cards");
      const density = await page.locator("article.rv3").getAttribute("data-density");
      const summaryLines = await page.locator(".dek .go").evaluate(el => getComputedStyle(el).webkitLineClamp);
      const overflow = await page.evaluate(() => window.document.documentElement.scrollWidth > innerWidth + 1);
      if (title !== "便携咖啡机" || density !== "compact" || summaryLines !== "3" || overflow) throw new Error(`Render invariant failed: ${JSON.stringify({ name, title, density, summaryLines, overflow })}`);
      await page.screenshot({ path: path.join(dir, `coffee-${name}.png`), fullPage: true });
      results.push({ viewport: name, title, density, summaryLines, overflow }); await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(dir, "render-results.json"), JSON.stringify({ fixture: true, realModel: false, realDatabase: false, results }, null, 2));
  console.log(JSON.stringify({ output: dir, results }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
