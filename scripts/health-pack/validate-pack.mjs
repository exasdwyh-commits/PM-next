#!/usr/bin/env node
/* 大健康开品数据底座 · 校验（依赖为零；Node 18+）
 *
 * 规则（任一违反即非零退出）：
 *   R1 表文件必须存在、可解析、含 rows 数组
 *   R2 每行必填：id / source / evidenceUrl / evidenceGrade / verifiedAt / status
 *   R3 evidenceGrade ∈ L1..L5；未核对行必须 status=unverified 且 verifiedAt=null
 *   R4 id 表内唯一；evidenceUrl 必须是 http(s)
 *   R5 功效类宣称（claims.efficacy=true）只有 L1–L3 才能 allowed，否则必须 pending_evidence
 *   R6 案例阶段 gate=passed 时必须有 evidence 引用（不许空手过门）
 *   R7 示例行纪律（dataOrigin=synthetic-demo）：必须 status=unverified、verifiedAt=null、
 *      不带证据来源/等级、source 必须标注示例；claims 里不得给法规结论（只能 pending_evidence）；
 *      regulatory_rules 表不允许出现示例行（法规只能来自人核对的 L1 原文）
 *
 * 用法：node scripts/health-pack/validate-pack.mjs [--pack <dir>] [--json <out>] [--quiet]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const PACK = path.resolve(arg("--pack", path.join(HERE, "..", "..", "packs", "health-food")));
const OUT_JSON = arg("--json", null);
const QUIET = argv.includes("--quiet");

const violations = [];
const stats = { tables: 0, rows: 0, cases: 0, sources: 0, synthetic: 0 };
const v = (rule, msg, at) => violations.push({ rule, msg, at: at || null });
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const DATA = path.join(PACK, "data");

/* ---------- schema ---------- */
let schema;
try {
  schema = readJson(path.join(DATA, "schema.json"));
  stats.tables = Object.keys(schema.tables || {}).length;
} catch (e) {
  v("R1", `schema.json 解析失败：${e.message}`, "data/schema.json");
}
if (schema && stats.tables !== 6) v("R1", `schema 里应有 6 张表，实际 ${stats.tables}`, "data/schema.json");

/* ---------- sources ---------- */
const sourceIds = new Set();
try {
  const src = readJson(path.join(DATA, "sources.json"));
  for (const s of src.sources || []) {
    stats.sources++;
    if (!s.id || !s.url) v("R1", "sources 条目缺 id/url", "data/sources.json");
    if (s.id) sourceIds.add(s.id);
    if (s.monitor && s.probe && s.probe.reachable === false)
      v("R1", `来源 ${s.id} 标记 monitor=true 但探测不可达（应改 false 或注明原因）`, "data/sources.json");
  }
} catch (e) {
  v("R1", `sources.json 解析失败：${e.message}`, "data/sources.json");
}

/* ---------- tables ---------- */
const REQUIRED = ["id", "source", "evidenceUrl", "evidenceGrade", "verifiedAt", "status"];
const GRADES = new Set(["L1", "L2", "L3", "L4", "L5"]);
const STATUS = new Set(["unverified", "verified", "pending_evidence", "rejected"]);

/* 示例行：允许存在，但必须自我声明，且不得伪装成证据行 */
const SYNTHETIC = "synthetic-demo";
const SYNTHETIC_SOURCE = "示例数据（synthetic-demo）";
const isSynthetic = (r) => !!r && r.dataOrigin === SYNTHETIC;
const NO_EVIDENCE_REQUIRED = new Set(["evidenceUrl", "evidenceGrade"]);

if (schema) {
  for (const [name, def] of Object.entries(schema.tables)) {
    const file = path.join(DATA, def.file);
    let doc;
    try {
      doc = readJson(file);
    } catch (e) {
      v("R1", `表 ${name} 读取失败：${e.message}`, `data/${def.file}`);
      continue;
    }
    if (!Array.isArray(doc.rows)) {
      v("R1", `表 ${name} 缺 rows 数组`, `data/${def.file}`);
      continue;
    }
    const seen = new Set();
    doc.rows.forEach((row, i) => {
      stats.rows++;
      const at = `data/${def.file}#${row.id || i}`;
      if (isSynthetic(row)) stats.synthetic++;
      for (const f of REQUIRED) {
        if (isSynthetic(row) && NO_EVIDENCE_REQUIRED.has(f)) continue;   // 示例行本就不该有证据
        if (row[f] === undefined || (f !== "verifiedAt" && (row[f] === null || row[f] === "")))
          v("R2", `表 ${name} 第 ${i + 1} 行缺字段 ${f}`, at);
      }
      if (isSynthetic(row)) {
        if (row.status !== "unverified" || row.verifiedAt !== null)
          v("R7", "示例行必须 status=unverified 且 verifiedAt=null（示例不是核对过的数据）", at);
        if (row.evidenceUrl || row.evidenceGrade)
          v("R7", "示例行不得带 evidenceUrl/evidenceGrade（示例不是证据）", at);
        if (row.source !== SYNTHETIC_SOURCE)
          v("R7", `示例行 source 必须写成「${SYNTHETIC_SOURCE}」`, at);
        if (name === "claims" && row.allowed !== "pending_evidence")
          v("R7", "示例宣称不得给法规结论（只允许 pending_evidence）", at);
        if (name === "regulatory_rules")
          v("R7", "法规表不允许放示例行（法规必须来自人核对的 L1 原文）", at);
      }
      if (row.evidenceGrade && !GRADES.has(row.evidenceGrade))
        v("R3", `evidenceGrade 非法：${row.evidenceGrade}`, at);
      if (row.status && !STATUS.has(row.status))
        v("R3", `status 非法：${row.status}`, at);
      if (row.status === "verified" && !row.verifiedAt)
        v("R3", "status=verified 但缺 verifiedAt", at);
      if (row.status === "unverified" && row.verifiedAt)
        v("R3", "status=unverified 却填了 verifiedAt（要么核对过，要么别填）", at);
      if (row.verifiedAt && !/^\d{4}-\d{2}-\d{2}$/.test(row.verifiedAt))
        v("R3", `verifiedAt 不是 YYYY-MM-DD：${row.verifiedAt}`, at);
      if (row.evidenceUrl && !/^https?:\/\//.test(row.evidenceUrl))
        v("R4", `evidenceUrl 不是 http(s)：${row.evidenceUrl}`, at);
      if (row.id) {
        if (seen.has(row.id)) v("R4", `id 重复：${row.id}`, at);
        seen.add(row.id);
      }
      if (name === "claims" && row.efficacy === true && row.allowed === "allowed" &&
          !["L1", "L2", "L3"].includes(row.evidenceGrade))
        v("R5", `功效宣称用 ${row.evidenceGrade} 判 allowed（只允许 L1–L3）`, at);
    });
  }
}

/* ---------- cases ---------- */
const CASES = path.join(DATA, "cases");
if (fs.existsSync(CASES)) {
  for (const f of fs.readdirSync(CASES).filter((x) => x.endsWith(".json"))) {
    let c;
    try {
      c = readJson(path.join(CASES, f));
    } catch (e) {
      v("R1", `案例 ${f} 解析失败：${e.message}`, `data/cases/${f}`);
      continue;
    }
    stats.cases++;
    for (const st of c.stages || []) {
      if (c._meta?.dataOrigin === SYNTHETIC && st.gate === "passed")
        v("R7", "模拟案例不得作为正式业务过门结果", `data/cases/${f}`);
      if (st.gate === "passed" && (!Array.isArray(st.evidence) || st.evidence.length === 0))
        v("R6", `案例 ${f} 阶段 ${st.id} 判 passed 但没有 evidence`, `data/cases/${f}`);
      if (st.gate === "passed" && (!st.outputs || st.outputs.length === 0))
        v("R6", `案例 ${f} 阶段 ${st.id} 判 passed 但没有产物`, `data/cases/${f}`);
    }
  }
}

/* ---------- 输出 ---------- */
const report = {
  check: "health-pack-validate",
  status: violations.length ? "fail" : "pass",
  count: violations.length,
  stats,
  pack: path.relative(process.cwd(), PACK).replaceAll(path.sep, "/"),
  violations: violations.slice(0, 40),
  checkedAt: new Date().toISOString(),
};
if (OUT_JSON) fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
if (!QUIET) {
  console.log(`health-pack 校验：${stats.tables} 表 / ${stats.rows} 行 / ${stats.cases} 案例 / ${stats.sources} 来源`);
  if (stats.synthetic)
    console.log(`  其中示例行 ${stats.synthetic} 条（synthetic-demo，不计入可用数据；补证据并去掉标记后才是真实行）`);
  if (violations.length) {
    console.log(`未通过：${violations.length} 项`);
    for (const x of violations.slice(0, 12)) console.log(`  [${x.rule}] ${x.msg}${x.at ? "  @ " + x.at : ""}`);
  } else {
    console.log("全部规则读零（R1–R7 通过）");
  }
}
console.log(JSON.stringify(report));
process.exit(violations.length ? 1 : 0);

