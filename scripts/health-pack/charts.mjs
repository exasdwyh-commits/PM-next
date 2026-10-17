#!/usr/bin/env node
/* 四张标准图 · 零依赖生成器（Node 18+）
 *
 * 图源约定（不编数字，没有就画诚实的空状态）：
 *   合规红黄绿 ← data/claims.json（判定分布 + 逐条清单）
 *   机会矩阵   ← data/cases/*.json 的 opportunities[]（假设态，未验证的点画空心）
 *   成本瀑布   ← data/cases/*.json 的 costModel（到手价 → 逐层扣减 → 贡献毛利）
 *   内容日历   ← data/cases/*.json 的 contentPlan[]
 *
 * 用法：node scripts/health-pack/charts.mjs [--case <id>] [--out <dir>] [--json]
 * 产物：4 个 .svg + index.html（都是纯静态，无字体/无外链）
 * 退出码：0 生成成功（含空状态）；1 案例文件缺失或损坏
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
const DATA = path.join(PACK, "data");
const OUT = path.resolve(arg("--out", path.join(DATA, "_artifacts")));
const CASE_ID = arg("--case", "low-sugar-high-protein");
const EMIT_JSON = argv.includes("--json");

const C = {
  bg: "#0d1117", panel: "#161b22", line: "#30363d", text: "#c9d1d9", dim: "#8b949e",
  green: "#3fb950", amber: "#d29922", red: "#f85149", blue: "#58a6ff", violet: "#bc8cff",
  cyan: "#39d2c0",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif">
<rect width="${w}" height="${h}" fill="${C.bg}"/>
${body}
</svg>`;
const head = (title, sub) => `
<text x="28" y="38" fill="${C.text}" font-size="19" font-weight="600">${esc(title)}</text>
<text x="28" y="61" fill="${C.dim}" font-size="12">${esc(sub)}</text>
<line x1="28" y1="76" x2="692" y2="76" stroke="${C.line}"/>`;
const empty = (w, h, msg) => `
<text x="${w / 2}" y="${h / 2}" fill="${C.dim}" font-size="14" text-anchor="middle">${esc(msg)}</text>
<text x="${w / 2}" y="${h / 2 + 22}" fill="${C.dim}" font-size="11" text-anchor="middle">空状态：不画假数据。按 schema 登记后重跑本脚本。</text>`;
const stamp = (h, note) => `<text x="28" y="${h - 14}" fill="${C.dim}" font-size="10">${esc(note)}</text>`;
/* ---------- 示例数据纪律（synthetic-demo 行不得冒充真实数据） ---------- */
const SAMPLE = "synthetic-demo";
const isSample = (rows) => Array.isArray(rows) && rows.some((r) => r && r.dataOrigin === SAMPLE);
const demoBadge = (on) =>
  on ? `<rect x="548" y="17" width="144" height="22" rx="11" fill="none" stroke="${C.amber}"/>
     <text x="620" y="32" fill="${C.amber}" font-size="11" text-anchor="middle">示例数据 · 非真实</text>` : "";

/* ---------- 1. 机会矩阵 ---------- */
function chartOpportunityMatrix(opps) {
  const W = 720, H = 560;
  if (!opps.length) {
    return svg(W, H, head("机会矩阵 · 人群需求 × 竞争强度", "来源：case.opportunities[]（假设态）") +
      `<rect x="90" y="110" width="560" height="380" fill="${C.panel}" stroke="${C.line}"/>
       <line x1="370" y1="110" x2="370" y2="490" stroke="${C.line}" stroke-dasharray="4 4"/>
       <line x1="90" y1="300" x2="650" y2="300" stroke="${C.line}" stroke-dasharray="4 4"/>
       <text x="90" y="107" fill="${C.dim}" font-size="11">竞争强</text>
       <text x="650" y="107" fill="${C.dim}" font-size="11" text-anchor="end">竞争弱</text>
       <text x="93" y="505" fill="${C.dim}" font-size="11">需求弱</text>
       <text x="647" y="505" fill="${C.dim}" font-size="11" text-anchor="end">需求强</text>
       <text x="370" y="340" fill="${C.dim}" font-size="12" text-anchor="middle">暂无机会假设</text>
       <text x="370" y="362" fill="${C.dim}" font-size="11" text-anchor="middle">在案例 insight 阶段登记 opportunities 后重跑</text>` +
      stamp(H, "生成时间：" + new Date().toISOString()));
  }
  const x = (v) => 90 + ((100 - v) / 100) * 560;          // 竞争强度：左强右弱
  const y = (v) => 490 - (v / 100) * 380;         // 需求强度：下弱上强
  let body = head("机会矩阵 · 人群需求 × 竞争强度", `来源：case.opportunities[]（共 ${opps.length} 项，空心=未验证假设）`) +
    demoBadge(isSample(opps)) +
    `<rect x="90" y="110" width="560" height="380" fill="${C.panel}" stroke="${C.line}"/>
     <line x1="370" y1="110" x2="370" y2="490" stroke="${C.line}" stroke-dasharray="4 4"/>
     <line x1="90" y1="300" x2="650" y2="300" stroke="${C.line}" stroke-dasharray="4 4"/>
     <text x="370" y="130" fill="${C.dim}" font-size="11" text-anchor="middle">高需求 · 弱竞争（优先）</text>
     <text x="370" y="475" fill="${C.dim}" font-size="11" text-anchor="middle">低需求 · 强竞争（避开）</text>`;
  opps.forEach((o, i) => {
    const px = x(o.competition ?? 50), py = y(o.demand ?? 50);
    const verified = o.status === "verified" && o.dataOrigin !== SAMPLE;
    body += `
     <circle cx="${px}" cy="${py}" r="9" fill="${verified ? C.cyan : "none"}" stroke="${C.cyan}" stroke-width="2"/>
     <text x="${px}" y="${py - 16}" fill="${C.text}" font-size="12" text-anchor="middle">${esc(o.name)}</text>
     <text x="${px}" y="${py + 24}" fill="${C.dim}" font-size="10" text-anchor="middle">${verified ? "已验证" : "待验证"}</text>`;
  });
  return svg(W, H, body + stamp(H, "红线：需求/竞争的分值必须能追到证据行；无证据的点画空心并标「待验证」。"));
}

/* ---------- 2. 成本瀑布 ---------- */
function chartCostWaterfall(model) {
  const W = 720, H = 560;
  const H0 = 110, H1 = 470, MAXW = 560, X0 = 90;
  if (!model || !model.rows || !model.rows.length) {
    return svg(W, H, head("成本瀑布 · 到手价 → 贡献毛利", "来源：case.costModel（需合同/报价：L4 事实来源）") + empty(W, H, "暂无成本数据"));
  }
  const price = Number(model.price || 0);
  let running = price;
  const rows = model.rows.map((r) => ({ ...r, amount: Number(r.amount || 0) }));
  const cost = rows.reduce((s, r) => s + r.amount, 0);
  const margin = price - cost;
  const steps = [{ label: "到手价", value: price, kind: "start" },
    ...rows.map((r) => ({ label: r.label, value: -r.amount, kind: "cost", grade: r.grade })),
    { label: "贡献毛利", value: margin, kind: "end" }];
  const max = price || 1;
  const bw = Math.min(86, MAXW / steps.length - 8);
  let body = head("成本瀑布 · 到手价 → 贡献毛利", `到手价 ${price.toFixed(2)}｜总成本 ${cost.toFixed(2)}｜贡献毛利 ${margin.toFixed(2)}（${model.currency || "CNY"}）`) + demoBadge(model.dataOrigin === SAMPLE);
  let cursor = 0;
  steps.forEach((s, i) => {
    const x = X0 + i * (bw + 8);

    let hgt, top;
    if (s.kind === "start" || s.kind === "end") { hgt = (Math.abs(s.value) / max) * (H1 - H0); top = H1 - hgt; }
    else { hgt = (Math.abs(s.value) / max) * (H1 - H0); top = H1 - (cursor / max) * (H1 - H0); cursor += s.value; }
    if (s.kind === "start") cursor = s.value;
    const color = s.kind === "start" ? C.blue : s.kind === "end" ? (s.value >= 0 ? C.green : C.red) : C.amber;
    body += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(2, hgt)}" fill="${color}" opacity=".85"/>
      <text x="${x + bw / 2}" y="${H1 + 18}" fill="${C.dim}" font-size="10" text-anchor="middle">${esc(s.label).slice(0, 8)}</text>
      <text x="${x + bw / 2}" y="${top - 6}" fill="${C.text}" font-size="10" text-anchor="middle">${s.value > 0 ? "" : "−"}${Math.abs(s.value).toFixed(2)}</text>`;
    if (s.grade) body += `<text x="${x + bw / 2}" y="${H1 + 32}" fill="${C.dim}" font-size="9" text-anchor="middle">${esc(s.grade)}</text>`;
  });
  if (model.targetCost) {
    const ty = H0 + ((max - model.targetCost) / max) * (H1 - H0);
    body += `<line x1="${X0}" y1="${ty}" x2="${X0 + MAXW}" y2="${ty}" stroke="${C.violet}" stroke-dasharray="6 4"/>
      <text x="${X0 + MAXW}" y="${ty - 6}" fill="${C.violet}" font-size="10" text-anchor="end">目标成本 ${Number(model.targetCost).toFixed(2)}</text>`;
  }
  return svg(W, H, body + stamp(H, "红线：费率/报价未取得正式文件的一律标 L4 拟定；禁止用「毛利 60%」这类只扣货成本的口径。"));
}

/* ---------- 3. 合规红黄绿 ---------- */
function chartClaims(claims) {
  const W = 720, H = 560;
  if (!claims.length) {
    return svg(W, H, head("宣称合规红黄绿", "来源：data/claims.json（判定须引 L1 法规原文）") + empty(W, H, "暂无宣称登记"));
  }
  const buckets = { allowed: [], forbidden: [], pending_evidence: [] };
  claims.forEach((c) => (buckets[c.allowed] || buckets.pending_evidence).push(c));
  const total = claims.length;
  const colorOf = { allowed: C.green, forbidden: C.red, pending_evidence: C.amber };
  const labelOf = { allowed: "证据支持（仍须业务确认）", forbidden: "禁止", pending_evidence: "待补证据" };
  const y0 = 120, barH = 30;
  let x = 90;
  let body = head("宣称合规红黄绿", `共 ${total} 条｜green ${buckets.allowed.length}｜amber ${buckets.pending_evidence.length}｜red ${buckets.forbidden.length}`) + demoBadge(isSample(claims));
  for (const k of ["allowed", "pending_evidence", "forbidden"]) {
    const w = (buckets[k].length / total) * 540;
    if (w > 0) body += `<rect x="${x}" y="${y0}" width="${w}" height="${barH}" fill="${colorOf[k]}" opacity=".9"/>
      <text x="${x + w / 2}" y="${y0 + 20}" fill="#0d1117" font-size="11" text-anchor="middle" font-weight="600">${buckets[k].length}</text>`;
    x += w;
  }
  body += `<text x="90" y="${y0 - 8}" fill="${C.dim}" font-size="11">${labelOf.allowed} → ${labelOf.pending_evidence} → ${labelOf.forbidden}</text>`;
  let yy = y0 + barH + 34;
  for (const k of ["forbidden", "pending_evidence", "allowed"]) {
    for (const c of buckets[k].slice(0, 6)) {
      body += `<circle cx="98" cy="${yy - 4}" r="5" fill="${colorOf[k]}"/>
        <text x="112" y="${yy}" fill="${C.text}" font-size="12">${esc(c.text).slice(0, 40)}</text>
        <text x="600" y="${yy}" fill="${C.dim}" font-size="10">${esc(c.evidenceGrade || "—")}｜${esc(c.status)}</text>`;
      yy += 26;
      if (yy > H - 60) break;
    }
    if (yy > H - 60) break;
  }
  return svg(W, H, body + stamp(H, "红线：任一 red 即整案 blocked；功效类只有 L1–L3 能判 allowed；本图为待签稿，verified 只能由人核对后设置。"));
}

/* ---------- 4. 内容日历 ---------- */
function chartContentCalendar(plan) {
  const W = 720, H = 650;
  const CW = 78, CH = 62, X0 = 90, Y0 = 110;
  const chanColor = { "抖音": C.red, "小红书": C.amber, "视频号": C.green, "私域": C.violet, "电商": C.blue };
  let body = head("内容日历 · 28 天排期", `来源：case.contentPlan[]（共 ${plan.length} 条；每条须挂已判 allowed 的宣称）`) + demoBadge(isSample(plan));
  for (let w = 0; w < 4; w++) body += `<text x="${X0 + w * (CW + 8)}" y="${Y0 - 8}" fill="${C.dim}" font-size="11">第 ${w + 1} 周</text>`;
  for (let d = 0; d < 28; d++) {
    const cx = X0 + Math.floor(d / 7) * (CW + 8), cy = Y0 + (d % 7) * (CH + 6);
    const items = plan.filter((p) => Number(p.day) === d + 1);
    body += `<rect x="${cx}" y="${cy}" width="${CW}" height="${CH}" rx="6" fill="${C.panel}" stroke="${items.length ? C.cyan : C.line}"/>
      <text x="${cx + 7}" y="${cy + 15}" fill="${C.dim}" font-size="10">D${d + 1}</text>`;
    items.slice(0, 3).forEach((it, i) => {
      body += `<circle cx="${cx + 12}" cy="${cy + 30 + i * 13}" r="4" fill="${chanColor[it.channel] || C.dim}"/>
        <text x="${cx + 21}" y="${cy + 33 + i * 13}" fill="${C.text}" font-size="9">${esc(String(it.topic || "").slice(0, 7))}</text>`;
      if (it.claimAllowed && it.claimAllowed !== "allowed")
        body += `<text x="${cx + CW - 8}" y="${cy + 15}" fill="${C.amber}" font-size="11" text-anchor="end" font-weight="700">!</text>`;
    });
  }
  return svg(W, H, body + stamp(H, "图例：红=抖音 黄=小红书 绿=视频号 紫=私域 蓝=电商｜! = 该条挂的宣称尚未判 allowed，不得发布" + (isSample(plan) ? "｜本图为示例排期" : "")));
}

/* ---------- main ---------- */
const caseFile = path.join(DATA, "cases", `${CASE_ID}.json`);
if (!fs.existsSync(caseFile)) {
  console.error(`案例文件不存在：${caseFile}`);
  process.exit(1);
}
let caseDoc;
try { caseDoc = readJson(caseFile); } catch (e) { console.error(`案例文件损坏：${e.message}`); process.exit(1); }
let claimsDoc = { rows: [] };
try { claimsDoc = readJson(path.join(DATA, "claims.json")); } catch { /* 空表也允许 */ }

const outs = {
  "opportunity-matrix.svg": chartOpportunityMatrix(caseDoc.opportunities || []),
  "cost-waterfall.svg": chartCostWaterfall(caseDoc.costModel),
  "claims-traffic-light.svg": chartClaims(claimsDoc.rows || []),
  "content-calendar.svg": chartContentCalendar(caseDoc.contentPlan || []),
};
fs.mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(outs)) fs.writeFileSync(path.join(OUT, name), content);

const index = `<!doctype html><meta charset="utf-8"><title>${esc(CASE_ID)} · 标准图</title>
<body style="margin:0;background:#0d1117;color:#c9d1d9;font:14px/1.6 Segoe UI,PingFang SC,Microsoft YaHei,sans-serif">
<h1 style="padding:20px 28px 0">${esc(caseDoc._meta?.case || CASE_ID)} · 四张标准图</h1>
<p style="padding:0 28px;color:#8b949e">由 <code>node scripts/health-pack/charts.mjs</code> 生成；空状态是诚实状态。</p>
${Object.keys(outs).map((n) => `<div style="padding:12px 28px"><img src="${n}" style="max-width:100%;border:1px solid #30363d;border-radius:8px"></div>`).join("")}
</body>`;
fs.writeFileSync(path.join(OUT, "index.html"), index);

const summary = {
  check: "health-pack-charts", status: "pass", case: CASE_ID, out: path.relative(process.cwd(), OUT).replaceAll(path.sep, "/"),
  charts: Object.fromEntries(Object.entries(outs).map(([n, c]) => [n, c.length])),
  emptyStates: {
    opportunities: (caseDoc.opportunities || []).length === 0,
    costModel: !(caseDoc.costModel && caseDoc.costModel.rows || []).length,
    claims: (claimsDoc.rows || []).length === 0,
    contentPlan: (caseDoc.contentPlan || []).length === 0,
  },
  sampleData: {
    opportunities: isSample(caseDoc.opportunities || []),
    costModel: !!(caseDoc.costModel && caseDoc.costModel.dataOrigin === SAMPLE),
    claims: isSample(claimsDoc.rows || []),
    contentPlan: isSample(caseDoc.contentPlan || []),
  },
  at: new Date().toISOString(),
};
console.log(`charts：生成 ${Object.keys(outs).length} 张到 ${summary.out}`);
for (const [k, v] of Object.entries(summary.emptyStates)) console.log(`  ${v ? "空状态" : "有数据"}  ${k}`);
if (EMIT_JSON) console.log(JSON.stringify(summary));

