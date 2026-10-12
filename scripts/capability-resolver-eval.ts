/**
 * Capability Resolver 离线评测跑分（W6）。
 *
 * 只读地跑一遍 `tests/data/capability-resolver-eval.json` 里的标注用例，比对
 * resolver 实际走的档位（EXPLICIT / INTENT / TRIGGER / NONE）与期望档位，输出：
 *   总体准确率 · 四档各自的准确率 · 混淆矩阵 · 误召/漏召 · 用例来源构成
 *
 * ⚠️ 本脚本**不改 resolver 的任何参数**（MIN_KEYWORD_SCORE / INTENT_BOOST /
 * PRIORITY_WEIGHT 一个数都没碰）。它的职责是把精度现状量化出来，让「resolver
 * 精度仍有余量」这种话变成可以对比的数字。
 *
 * 用法：
 *   npx tsx scripts/capability-resolver-eval.ts
 *   npx tsx scripts/capability-resolver-eval.ts --json
 *   npx tsx scripts/capability-resolver-eval.ts --verbose   # 列出每条不符的用例
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCapabilities } from "@/modules/assistant-runtime/capabilities/resolver";
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts/capability";
import { loadCapabilitySkills } from "@/modules/assistant-runtime/capabilities/skill-registry";

export const EVAL_DATA_PATH = path.join(
  process.cwd(),
  "tests/data/capability-resolver-eval.json"
);

export type EvalSource = "EXPLICIT" | "INTENT" | "TRIGGER" | "NONE";
export const EVAL_SOURCES: EvalSource[] = ["EXPLICIT", "INTENT", "TRIGGER", "NONE"];

export interface EvalCase {
  id: string;
  text: string;
  intent: string;
  explicitSkillIds?: string[];
  expected: EvalSource;
  origin: string;
  note?: string;
}

export interface EvalCaseResult {
  id: string;
  expected: EvalSource;
  actual: EvalSource;
  correct: boolean;
  origin: string;
  /** 期望与实际不符时的现场信息，便于定位是标注问题还是 resolver 问题。 */
  detail?: { intent: string; text: string; reason: string; picked: string[]; note?: string };
}

export interface EvalReport {
  total: number;
  correct: number;
  accuracy: number;
  perClass: Record<EvalSource, { count: number; correct: number; accuracy: number }>;
  /** 混淆矩阵[期望档][实际档] = 条数。 */
  confusion: Record<EvalSource, Record<EvalSource, number>>;
  /** expected=NONE 却判成了别的档（把不命中编成命中）。 */
  falsePositive: number;
  falsePositiveRate: number;
  /** expected≠NONE 却判成 NONE（该命中没命中）。 */
  falseNegative: number;
  falseNegativeRate: number;
  byOrigin: { origin: string; count: number; correct: number; accuracy: number }[];
  mismatches: EvalCaseResult[];
}

export function loadEvalCases(file: string = EVAL_DATA_PATH): EvalCase[] {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { cases: EvalCase[] };
  return parsed.cases;
}

function emptyConfusion(): Record<EvalSource, Record<EvalSource, number>> {
  const matrix = {} as Record<EvalSource, Record<EvalSource, number>>;
  for (const e of EVAL_SOURCES) {
    matrix[e] = {} as Record<EvalSource, number>;
    for (const a of EVAL_SOURCES) matrix[e][a] = 0;
  }
  return matrix;
}

/**
 * 跑分。`skills` 可注入（测试用），不传则加载仓库真实能力包。
 * 只读：不写库、不改任何能力包、不改 resolver 参数。
 */
export function runEval(
  cases: readonly EvalCase[],
  options: { skills?: readonly CapabilitySkillDefinition[] } = {}
): EvalReport {
  const results: EvalCaseResult[] = [];
  for (const item of cases) {
    const resolution = resolveCapabilities({
      text: item.text,
      intent: item.intent,
      explicitSkillIds: item.explicitSkillIds ?? null,
      ...(options.skills ? { skills: [...options.skills] } : {}),
    });
    const actual = resolution.source as EvalSource;
    const correct = actual === item.expected;
    results.push({
      id: item.id,
      expected: item.expected,
      actual,
      correct,
      origin: item.origin,
      detail: correct
        ? undefined
        : {
            intent: item.intent,
            text: item.text,
            reason: resolution.reason,
            picked: resolution.skills.map((s) => s.id),
            note: item.note,
          },
    });
  }

  const confusion = emptyConfusion();
  const perClass = {} as Record<EvalSource, { count: number; correct: number; accuracy: number }>;
  for (const source of EVAL_SOURCES) perClass[source] = { count: 0, correct: 0, accuracy: 0 };
  const originTally = new Map<string, { count: number; correct: number }>();

  for (const r of results) {
    confusion[r.expected][r.actual] += 1;
    perClass[r.expected].count += 1;
    if (r.correct) perClass[r.expected].correct += 1;
    const bucket = originTally.get(r.origin) ?? { count: 0, correct: 0 };
    bucket.count += 1;
    if (r.correct) bucket.correct += 1;
    originTally.set(r.origin, bucket);
  }

  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const noneCases = results.filter((r) => r.expected === "NONE");
  const hitCases = results.filter((r) => r.expected !== "NONE");
  const falsePositive = noneCases.filter((r) => r.actual !== "NONE").length;
  const falseNegative = hitCases.filter((r) => r.actual === "NONE").length;

  for (const source of EVAL_SOURCES) {
    const bucket = perClass[source];
    bucket.accuracy = bucket.count ? bucket.correct / bucket.count : 0;
  }

  return {
    total,
    correct,
    accuracy: total ? correct / total : 0,
    perClass,
    confusion,
    falsePositive,
    falsePositiveRate: noneCases.length ? falsePositive / noneCases.length : 0,
    falseNegative,
    falseNegativeRate: hitCases.length ? falseNegative / hitCases.length : 0,
    byOrigin: [...originTally.entries()]
      .map(([origin, b]) => ({
        origin,
        count: b.count,
        correct: b.correct,
        accuracy: b.count ? b.correct / b.count : 0,
      }))
      .sort((a, b) => b.count - a.count),
    mismatches: results.filter((r) => !r.correct),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function render(report: EvalReport, verbose: boolean): string {
  const out: string[] = [];
  out.push("═".repeat(64));
  out.push("W6 Capability Resolver 离线评测（只读跑分，不改任何参数）");
  out.push("═".repeat(64));
  out.push(`用例 ${report.total} 条 · 正确 ${report.correct} 条 · 总体准确率 ${pct(report.accuracy)}`);
  out.push("");
  out.push("各档准确率：");
  for (const source of EVAL_SOURCES) {
    const b = report.perClass[source];
    out.push(`  ${source.padEnd(9)} ${String(b.correct).padStart(3)}/${String(b.count).padEnd(3)}  ${pct(b.accuracy)}`);
  }
  out.push("");
  out.push(`误召（应 NONE 却命中）：${report.falsePositive} / ${report.perClass.NONE.count}  ${pct(report.falsePositiveRate)}`);
  out.push(`漏召（应命中却 NONE）：${report.falseNegative} / ${report.total - report.perClass.NONE.count}  ${pct(report.falseNegativeRate)}`);
  out.push("");
  out.push("用例来源构成：");
  for (const o of report.byOrigin) {
    out.push(`  ${o.origin.padEnd(6)} ${String(o.count).padStart(3)} 条 · 正确率 ${pct(o.accuracy)}`);
  }
  out.push("");
  out.push("混淆矩阵（行=期望，列=实际）：");
  out.push(`        ${EVAL_SOURCES.map((s) => s.slice(0, 8).padStart(9)).join("")}`);
  for (const expected of EVAL_SOURCES) {
    const row = EVAL_SOURCES.map((actual) => String(report.confusion[expected][actual]).padStart(9)).join("");
    out.push(`  ${expected.slice(0, 6).padEnd(6)}${row}`);
  }
  if (report.mismatches.length) {
    out.push("");
    out.push(`不符用例 ${report.mismatches.length} 条${verbose ? "：" : "（加 --verbose 查看明细）"}`);
    if (verbose) {
      for (const m of report.mismatches) {
        out.push(`  ✗ ${m.id} 期望 ${m.expected} 实际 ${m.actual}`);
        out.push(`      text: ${m.detail?.text}`);
        out.push(`      intent: ${m.detail?.intent} · reason: ${m.detail?.reason}`);
        if (m.detail?.picked.length) out.push(`      选中: ${m.detail?.picked.join(", ")}`);
      }
    }
  }
  return out.join("\n");
}

function main(): void {
  const cases = loadEvalCases();
  const { skills, diagnostics } = loadCapabilitySkills();
  if (diagnostics.length) {
    console.error(`⚠️ 能力包加载有 ${diagnostics.length} 条诊断，评测结果可能失真：`);
    for (const d of diagnostics) console.error(`  ${d.sourcePath}: ${d.reason}`);
  }
  const report = runEval(cases, { skills });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(render(report, process.argv.includes("--verbose")));
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) main();
