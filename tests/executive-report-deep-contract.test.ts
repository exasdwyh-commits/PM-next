import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEEP_SECTION_META,
  validateDeepSpec,
  validateDeepBom,
  validateDeepValidation,
  composeDeepReport,
  pickTaskDeep,
} from "../src/modules/product-rnd/deep-report";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─────────────────────────────────────────────
// 1. 校验 fail-closed：畸形输入一律丢弃，不得流入报告体
// ─────────────────────────────────────────────
test("deep spec validator drops malformed rows and rejects empty shells", () => {
  assert.equal(validateDeepSpec(undefined), undefined);
  assert.equal(validateDeepSpec({ rows: [] }), undefined);
  assert.equal(validateDeepSpec("garbage"), undefined);
  // 只有缺主键的行 → 整块作废
  assert.equal(validateDeepSpec({ rows: [{ note: "无 name/value" }] }), undefined);
  const ok = validateDeepSpec({
    title: "复合酶片",
    rows: [
      { name: "每片重量", value: "0.5", unit: "g", claimKind: "fact", evidenceRef: "evidence:1" },
      { value: "缺 name 应被丢弃" },
      { name: "剂型", value: "咀嚼片", claimKind: "not-a-kind" },
    ],
  });
  assert.ok(ok);
  assert.equal(ok.rows.length, 2);
  assert.equal(ok.rows[0].claimKind, "FACT"); // 大小写归一
  assert.equal(ok.rows[1].claimKind, undefined); // 非白名单三态一律置空（视图显示 UNKNOWN）
});

test("deep bom validator requires item key and preserves explicit gaps", () => {
  assert.equal(validateDeepBom({ lines: [{ qty: 5 }] }), undefined);
  const ok = validateDeepBom({
    basis: "60 片/瓶",
    lines: [
      { item: "原料A", qty: 2, uom: "g", unitCost: 0.21, total: 0.42, sourceRef: "quote:qa-100" },
      { item: "包材-瓶", total: "—", sourceRef: null },
    ],
  });
  assert.ok(ok);
  assert.equal(ok.lines.length, 2);
  assert.equal(ok.lines[1].total, "—"); // 显式标缺必须原样保留
  assert.equal(ok.currency, "CNY");
});

test("deep validation validator computes honest totals", () => {
  const ok = validateDeepValidation({
    items: [
      { claim: "结论A", latestStatus: "SUPPORTED" },
      { claim: "结论B", latestStatus: "CONTRADICTED" },
      { claim: "结论C" },
    ],
    gaps: ["缺口X"],
    qaStatus: "PARTIAL",
  });
  assert.ok(ok);
  assert.deepEqual(ok.totals, { claims: 3, supported: 1, unverified: 2 });
  assert.equal(ok.items[2].latestStatus, "NO_VERIFICATION");
});

test("composeDeepReport yields unknown skeleton when nothing real exists", () => {
  const deep = composeDeepReport({ spec: undefined, bom: undefined, validation: undefined, appendixCount: 0 });
  assert.equal(deep.spec, undefined);
  assert.equal(deep.bom, undefined);
  assert.equal(deep.sections.length, 9);
  assert.ok(deep.sections.every((s) => s.ready === false));
  assert.ok(deep.sections.every((s) => typeof s.gap === "string" && s.gap.length > 0));
});

test("composeDeepReport flags ready sections only where validated data exists", () => {
  const deep = composeDeepReport({
    spec: { rows: [{ name: "剂型", value: "片剂" }] },
    validation: { items: [{ claim: "c", latestStatus: "SUPPORTED" }] },
    appendixCount: 3,
  });
  const state = Object.fromEntries(deep.sections.map((s) => [s.key, s.ready]));
  assert.equal(state.definition, true);
  assert.equal(state.validation, true);
  assert.equal(state.appendix, true);
  assert.equal(state.bom, false);
  assert.equal(state.fmea, false);
  // ready 节不得携带 gap，unknown 节必须有 gap
  for (const s of deep.sections) {
    assert.equal(s.ready ? s.gap === undefined : typeof s.gap === "string", true, `section ${s.key} gap/ready 不一致`);
  }
});

// ─────────────────────────────────────────────
// 2. 通道：executorResult.deep 从 contextSnapshot 读取（typed 通道，零文本解析）
// ─────────────────────────────────────────────
test("pickTaskDeep reads only the typed channel; misses return undefined", () => {
  const tasks = [
    { agent: { code: "formulation_agent" }, contextSnapshot: { executorResult: { deep: { spec: { rows: [{ name: "a", value: "b" }] } } } } },
    { agent: { code: "cost_bom_agent" }, contextSnapshot: {} },
  ] as any;
  assert.ok(pickTaskDeep(tasks, "formulation_agent", "spec"));
  assert.equal(pickTaskDeep(tasks, "cost_bom_agent", "bom"), undefined);
  assert.equal(pickTaskDeep(tasks, "ghost_agent", "spec"), undefined);
});

// ─────────────────────────────────────────────
// 3. 九节常量就是事实源：key 集合与契约联合类型一致（改一边必须改另一边）
// ─────────────────────────────────────────────
test("nine-section meta matches report-full standard order", () => {
  assert.deepEqual(
    DEEP_SECTION_META.map((s) => s.key),
    ["definition", "bom", "process", "quality", "economics", "compliance", "fmea", "validation", "appendix"]
  );
  assert.ok(DEEP_SECTION_META.every((s) => s.fill.length > 10), "每节必须给出补齐路径");
});

// ─────────────────────────────────────────────
// 4. 编造回归钳制：视图与深度报告模块不得再出现已知编造串（#58/#60 先例）
// ─────────────────────────────────────────────
test("role report components contain no fabricated demo numbers", () => {
  const targets = [
    "src/components/executive-report-role-based.tsx",
    "src/modules/product-rnd/deep-report.ts",
    "src/modules/supervisor/role-aware-report.ts",
  ];
  const FORBIDDEN = ["10.2元", "82%留存", "留存率 82%", "多酚留存82", "成本仅10", "299元,价格带", "市场200亿"];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf-8");
    for (const bad of FORBIDDEN) {
      assert.ok(!src.includes(bad), `${rel} 含已知编造串：${bad}`);
    }
  }
});

test("deep report view renders UNKNOWN placeholders and three-state badges", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/components/executive-report-role-based.tsx"), "utf-8");
  assert.ok(src.includes("DeepReportSections"), "ProductView 未挂载深度报告段");
  assert.ok(src.includes("deep-gap"), "缺 UNKNOWN 占位块渲染");
  assert.ok(src.includes("deepReport"), "视图未消费 deepReport 契约");
  assert.ok(src.includes("ErrEv"), "三态徽章复用缺失");
});
