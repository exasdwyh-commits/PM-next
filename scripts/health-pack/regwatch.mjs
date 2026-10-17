#!/usr/bin/env node
/* 法规监控最小闭环（依赖为零；Node 18+ 自带 fetch）
 *
 * 做四件事：抓取 → 快照 → 比对 → 出变更报告。**不自动改数据、不自动派活**：
 * 变更只落报告，登记成 regulatory_rules 仍由人确认后再写入（先人工确认，再谈自动化）。
 *
 * 用法：
 *   node scripts/health-pack/regwatch.mjs --dry-run          # 只列计划，不抓不写
 *   node scripts/health-pack/regwatch.mjs                    # 抓 monitor:true 的来源
 *   node scripts/health-pack/regwatch.mjs --only samr        # 只抓一个
 *   node scripts/health-pack/regwatch.mjs --json <out>       # 结果落 JSON
 *   node scripts/health-pack/regwatch.mjs --tolerant         # 定时任务用：失败仍 exit 0，但记录在案
 *   node scripts/health-pack/regwatch.mjs --state-dir <dir>  # 产物目录外置（默认 packs/health-food/data/_snapshots）
 *
 * 退出码：0 全部抓取成功（有变更也算成功）；1 有来源抓取失败；2 用法/配置错误
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const DRY = argv.includes("--dry-run");
const ONLY = arg("--only", null);
const OUT_JSON = arg("--json", null);
const TOLERANT = argv.includes("--tolerant");   // 供定时任务：网络抖动不报警，但仍如实记录
const PACK = path.resolve(arg("--pack", path.join(HERE, "..", "..", "packs", "health-food")));
const DATA = path.join(PACK, "data");
const SNAP = path.resolve(arg("--state-dir", path.join(DATA, "_snapshots")));  // 产物目录，可外置

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 20000;
const today = new Date().toISOString().slice(0, 10);

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const title = (html) => {
  const m = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
};

async function grab(url, tries = 3) {
  // 一次网络抖动不该让一次监控落空：退避重试 3 次（0.5s / 1.2s）
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: ctl.signal,
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(t);
      return { ok: res.ok, httpCode: res.status, buf, finalUrl: res.url, attempts: i + 1 };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1) + 200 * i));
    }
  }
  throw lastErr || new Error("fetch failed");
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/* ---------------- main ---------------- */
const srcDoc = readJson(path.join(DATA, "sources.json"));
if (!srcDoc) {
  console.error("data/sources.json 读不到或解析失败");
  process.exit(2);
}
const wanted = (srcDoc.sources || []).filter((s) => (ONLY ? s.id === ONLY : s.monitor === true));
if (ONLY) {
  const exists = (srcDoc.sources || []).some((s) => s.id === ONLY);
  if (!exists) {
    console.error(`--only ${ONLY} 不在 sources.json 里`);
    process.exit(2);
  }
}

const results = [];
const skipped = (srcDoc.sources || [])
  .filter((s) => s.monitor !== true && !ONLY)
  .map((s) => ({ id: s.id, why: s.probe && s.probe.note ? s.probe.note : "monitor=false" }));

for (const s of wanted) {
  if (s.probe && s.probe.reachable === false) {
    results.push({ id: s.id, ok: false, skipped: true, why: `登记为不可达：${s.probe.note || ""}` });
    continue;
  }
  const dir = path.join(SNAP, s.id);
  const prev = readJson(path.join(dir, "latest.json"));
  if (DRY) {
    results.push({ id: s.id, dryRun: true, url: s.url, prevSha: prev ? prev.sha256.slice(0, 12) : null });
    continue;
  }
  let g;
  try {
    g = await grab(s.url);
  } catch (e) {
    results.push({ id: s.id, ok: false, error: String(e.message || e) });
    continue;
  }
  if (!g.ok) {
    results.push({ id: s.id, ok: false, httpCode: g.httpCode, error: "HTTP 非 2xx" });
    continue;
  }
  const digest = sha(g.buf);
  const changed = !prev || prev.sha256 !== digest;
  fs.mkdirSync(dir, { recursive: true });
  if (changed) fs.writeFileSync(path.join(dir, `${today}.html`), g.buf);
  const rec = {
    id: s.id, name: s.name, url: s.url, finalUrl: g.finalUrl, httpCode: g.httpCode,
    bytes: g.buf.length, sha256: digest, title: title(g.buf.toString("utf8")), attempts: g.attempts,
    fetchedAt: new Date().toISOString(), changed,
  };
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(rec, null, 2));
  results.push({ id: s.id, ok: true, ...rec, prevSha: prev ? prev.sha256.slice(0, 12) : null });
}

/* ---------------- 变更报告 ---------------- */
const changed = results.filter((r) => r.ok && r.changed);
const failed = results.filter((r) => r.ok === false && !r.skipped);
if (!DRY && results.length) {
  fs.mkdirSync(SNAP, { recursive: true });
  const lines = [
    `# regwatch 变更报告 · ${today}`,
    "",
    `抓取 ${results.filter((r) => r.ok).length} 个来源；有变更 ${changed.length} 个；失败 ${failed.length} 个。`,
    "",
    ...results.map((r) =>
      r.dryRun ? `- (dry-run) ${r.id} → ${r.url}`
        : r.skipped ? `- 跳过 ${r.id}：${r.why}`
          : r.ok === false ? `- ✗ ${r.id}：${r.error || ("HTTP " + r.httpCode)}`
            : `- ${r.changed ? "⚠ 有变更" : "＝ 无变更"} ${r.id}：${r.title || "(无标题)"} ｜ ${r.bytes}B ｜ ${r.sha256.slice(0, 12)}`),
    "",
    "> 变更不等于法规结论。登记进 regulatory_rules 需要人打开快照核对 L1 原文后再写入。",
  ];
  fs.appendFileSync(path.join(SNAP, "changes.md"), lines.join("\n") + "\n\n");
  if (changed.length) {
    fs.writeFileSync(
      path.join(SNAP, `changes-${today}T${new Date().toISOString().slice(11, 16).replace(":", "")}.json`),
      JSON.stringify({ at: new Date().toISOString(), changed }, null, 2)
    );
  }
}

const summary = {
  check: "health-pack-regwatch",
  status: failed.length ? (TOLERANT ? "warn" : "fail") : "pass",
  dryRun: DRY,
  tolerant: TOLERANT,
  fetched: results.filter((r) => r.ok).length,
  changed: changed.map((r) => r.id),
  failed: failed.map((r) => ({ id: r.id, error: r.error || r.httpCode })),
  skipped,
  detail: results,
  at: new Date().toISOString(),
};
if (OUT_JSON) fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
console.log(`regwatch：抓取 ${summary.fetched} 个${DRY ? "（dry-run）" : ""}，有变更 ${summary.changed.length} 个（${summary.changed.join(", ") || "无"}），失败 ${summary.failed.length} 个${TOLERANT && failed.length ? "（tolerant：不报警）" : ""}`);
for (const r of results) {
  if (r.dryRun) console.log(`  dry-run  ${r.id} → ${r.url}`);
  else if (r.skipped) console.log(`  跳过     ${r.id}：${r.why}`);
  else if (r.ok === false) console.log(`  失败     ${r.id}：${r.error || r.httpCode}`);
  else console.log(`  ${r.changed ? "变更" : "无变更"}   ${r.id}  ${r.title || ""}  ${r.bytes}B  ${r.sha256.slice(0, 12)}`);
}
console.log(JSON.stringify(summary));
process.exit(failed.length && !TOLERANT ? 1 : 0);

