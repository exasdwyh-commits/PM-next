#!/usr/bin/env node
/* 候选法规线索采集 · 零依赖（Node 18+）
 *
 * 只做一件事：从已抓取的官方页面快照里，把**可能与食品标签/标准/公告相关**的链接标题挑出来，
 * 产出一份「候选线索」清单，供人打开官方原文核对后登记进 data/regulatory_rules.json。
 *
 * 明确不做：不判断法规内容、不写 regulatory_rules、不给结论。
 * 依据用户口径：AI 出稿，人签字。
 *
 * 用法：
 *   node scripts/health-pack/collect-candidates.mjs            # 读取 _snapshots 里最新的快照
 *   node scripts/health-pack/collect-candidates.mjs --top 30   # 列前 30 条
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const PACK = path.resolve(arg("--pack", path.join(HERE, "..", "..", "packs", "health-food")));
const SNAP = path.resolve(arg("--state-dir", path.join(PACK, "data", "_snapshots")));
const TOP = Number(arg("--top", 40));

const KEY = /(营养|标签|标准|公告|保健|新食品|原料|添加剂|限量|宣称|预包装|膳食|法规|征求意见|GB\s?\d)/;
const today = new Date().toISOString().slice(0, 10);

function latestHtml(sourceDir) {
  if (!fs.existsSync(sourceDir)) return null;
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".html")).sort();
  return files.length ? path.join(sourceDir, files[files.length - 1]) : null;
}

function extract(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const rawHref = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 4 || !KEY.test(text)) continue;
    if (/^(javascript:|#|mailto:)/i.test(rawHref)) continue;
    let url;
    try { url = new URL(rawHref, baseUrl).href; } catch { continue; }
    out.push({ title: text.slice(0, 120), url });
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.url) ? false : seen.add(x.url)));
}

const sources = fs.existsSync(SNAP)
  ? fs.readdirSync(SNAP).filter((d) => fs.statSync(path.join(SNAP, d)).isDirectory())
  : [];
if (!sources.length) {
  console.error(`没有快照可读：${SNAP}\n先跑：node scripts/health-pack/regwatch.mjs`);
  process.exit(1);
}

const collected = [];
for (const s of sources) {
  const file = latestHtml(path.join(SNAP, s));
  if (!file) continue;
  const html = fs.readFileSync(file, "utf8");
  const items = extract(html, s === "std-samr" ? "https://std.samr.gov.cn/" : `https://www.${s}.gov.cn/`);
  collected.push({ source: s, file: path.basename(file), items });
}

const total = collected.reduce((n, c) => n + c.items.length, 0);
const lines = [
  `# 候选法规线索 · ${today}`,
  "",
  `从 ${collected.length} 个来源的**页面快照**里挑出可能相关的链接，共 ${total} 条。`,
  "**这些不是结论**：标题只是线索，判定必须打开官方原文核对后再登记。",
  "",
];
for (const c of collected) {
  lines.push(`## ${c.source}（快照 ${c.file}）`);
  if (!c.items.length) { lines.push("- （无可匹配链接）", ""); continue; }
  for (const it of c.items.slice(0, TOP)) lines.push(`- [ ] ${it.title}\n      ${it.url}`);
  lines.push("");
}
lines.push("> 登记路径：核对原文 → 写入 `data/regulatory_rules.json`（带 evidenceUrl + L1 + verifiedAt）→ 跑 validate-pack。");

const outFile = path.join(SNAP, `candidates-${today}.md`);
fs.writeFileSync(outFile, lines.join("\n") + "\n");
console.log(`候选线索：${total} 条，来自 ${collected.length} 个来源快照`);
console.log(`清单已写：${path.relative(process.cwd(), outFile).replaceAll(path.sep, "/")}`);
for (const c of collected) {
  console.log(`  ${c.source}: ${c.items.length} 条` + (c.items[0] ? `  例：${c.items[0].title.slice(0, 34)}` : ""));
}
console.log("提醒：清单只供人工核对，不构成法规结论。");

