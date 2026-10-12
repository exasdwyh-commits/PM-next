/**
 * W6 能力解析离线评测集 —— 数据集与跑分脚本的自检。
 *
 * ⚠️ 这里**故意不设准确率门槛**：本评测集的职责是**度量** resolver 的四档路由精度，
 * 不是当门禁。设门槛会在别人改进/调参 resolver 时制造假红，把度量工具变成阻塞工具。
 * 因此只断言「数据集结构合法 + 跑分能跑 + 指标可算」，真实分数由
 * `npx tsx scripts/capability-resolver-eval.ts` 输出。
 *
 * 唯一被钉死的是**数据质量**：用例数、四类均衡、expected 合法、来源标注齐全、
 * EXPLICIT 用例点名的能力包 id 真实存在（id 写错会让 EXPLICIT 档直接失效，
 * 却不会报任何错 —— 和 `requiredTools` 写错工具名是同一类静默失败）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVAL_SOURCES,
  loadEvalCases,
  runEval,
  type EvalSource,
} from "../scripts/capability-resolver-eval";
import { loadCapabilitySkills } from "@/modules/assistant-runtime/capabilities/skill-registry";

const cases = loadEvalCases();

test("评测集规模达标：≥60 条，四类各 ≥15 条（均衡）", () => {
  assert.ok(cases.length >= 60, `用例数应 ≥60，实际 ${cases.length}`);
  for (const source of EVAL_SOURCES) {
    const count = cases.filter((c) => c.expected === source).length;
    assert.ok(count >= 15, `${source} 类用例应 ≥15 条，实际 ${count}`);
  }
});

test("每条用例的 expected 合法、来源标注非空、id 唯一", () => {
  const seen = new Set<string>();
  for (const item of cases) {
    assert.ok(EVAL_SOURCES.includes(item.expected), `${item.id} 的 expected 非法：${item.expected}`);
    assert.ok(item.origin?.trim(), `${item.id} 缺来源标注`);
    assert.ok(item.text?.trim(), `${item.id} 缺 text`);
    assert.ok(item.intent?.trim(), `${item.id} 缺 intent`);
    assert.ok(!seen.has(item.id), `用例 id 重复：${item.id}`);
    seen.add(item.id);
  }
});

test("EXPLICIT 用例点名的能力包 id 真实存在（写错会静默失效）", () => {
  const { skills } = loadCapabilitySkills();
  const ids = new Set(skills.map((s) => s.id));
  const referenced = cases.flatMap((c) => c.explicitSkillIds ?? []);
  assert.ok(referenced.length > 0, "应有 EXPLICIT 用例引用真实能力包 id");
  for (const id of referenced) {
    assert.ok(ids.has(id), `用例引用了不存在的能力包 id：${id}`);
  }
});

test("跑分脚本可跑通，指标结构完整（只读，不改 resolver 参数）", () => {
  const report = runEval(cases);

  assert.equal(report.total, cases.length);
  assert.ok(report.correct >= 0 && report.correct <= report.total);
  assert.ok(report.accuracy >= 0 && report.accuracy <= 1);

  for (const source of EVAL_SOURCES) {
    const bucket = report.perClass[source];
    const expectedCount = cases.filter((c) => c.expected === source).length;
    assert.equal(bucket.count, expectedCount, `${source} 的统计条数应与数据集一致`);
    assert.ok(bucket.accuracy >= 0 && bucket.accuracy <= 1);
  }

  // 混淆矩阵的行和 = 该类用例总数
  for (const source of EVAL_SOURCES) {
    const rowSum = EVAL_SOURCES.reduce((sum, actual) => sum + report.confusion[source][actual], 0);
    assert.equal(rowSum, report.perClass[source].count, `${source} 行混淆矩阵求和应等于该类总数`);
  }

  assert.ok(report.byOrigin.length > 0, "应给出用例来源构成");
  for (const o of report.byOrigin) assert.ok(o.origin.trim());

  // 基线数字：只打印不设门槛，便于人工对比（CLI 加 --verbose 可看逐条不符）
  const line = EVAL_SOURCES.map(
    (s: EvalSource) => `${s} ${(report.perClass[s].accuracy * 100).toFixed(1)}%`
  ).join(" · ");
  console.log(
    `      baseline: acc=${(report.accuracy * 100).toFixed(1)}%  ${line}  ` +
      `误召=${report.falsePositive} 漏召=${report.falseNegative}`
  );
});
