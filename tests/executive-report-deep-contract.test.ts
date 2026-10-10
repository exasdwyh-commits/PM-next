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
import {
  buildDeepSpecFromQuotes,
  buildDeepBomFromQuotes,
  normalizeQuoteRows,
  MISSING_MARK,
  type LoadedQuote,
} from "../src/modules/product-rnd/supplier-quotes";

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
    // 批次C+：playbook 大雷已拆，纳入同一钳制
    "src/modules/product-rnd/playbook.ts",
  ];
  const FORBIDDEN = ["10.2元", "82%留存", "留存率 82%", "多酚留存82", "成本仅10", "299元,价格带", "市场200亿", "方案A 成本最优", "目标8元", "多酚+低聚果糖", "蓝帽子已合规", "evidenceCount: 10"];
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

// ─────────────────────────────────────────────
// 5. P0-1 数据供给：真实资料点亮 ①② 块
//
// 这两块此前「很诚实地空着」——不是渲染缺陷，而是根本没有真实输入。
// 本组用例守住两件事：有真实资料时必须点亮且每行带来源锚点；
// 没有资料或某项缺数据时必须原样标缺，绝不回填 0 / 估算值。
// ─────────────────────────────────────────────

/** 造一条已入库的报价 / 规格行（字段与 loadProjectQuotes 的返回形状一致）。 */
function fixtureQuote(
  overrides: Partial<LoadedQuote> & { evidenceId: string; kind?: "SPEC" | "PRICE" }
): LoadedQuote {
  const evidenceId = overrides.evidenceId;
  return {
    id: `quote-${evidenceId}`,
    organizationId: "org-1",
    projectId: "project-1",
    kind: overrides.kind ?? "SPEC",
    supplier: null,
    item: "原料A",
    spec: null,
    uom: null,
    moq: null,
    unitPrice: null,
    currency: "CNY",
    quotedAt: null,
    note: null,
    createdById: "user-1",
    createdAt: new Date("2026-10-11T00:00:00Z"),
    updatedAt: new Date("2026-10-11T00:00:00Z"),
    evidence: {
      id: evidenceId,
      source: "供应商报价单",
      verifyStatus: "UNVERIFIED",
      originalFilename: "quote.pdf",
      obtainedAt: new Date("2026-10-11T00:00:00Z"),
    },
    ...overrides,
    // 放在最后：evidenceId 是本夹具的唯一来源锚点，不允许被 overrides 意外改写，
    // 否则「每行带来源锚点」这条断言就失去意义。
    evidenceId,
  } as LoadedQuote;
}

test("P0-1: 真实规格资料点亮 ① 定义与规格块，每行必须带来源锚点", () => {
  const spec = buildDeepSpecFromQuotes([
    fixtureQuote({ evidenceId: "ev-1", kind: "SPEC", item: "每片重量", spec: "0.5", uom: "g" }),
    fixtureQuote({ evidenceId: "ev-2", kind: "SPEC", item: "剂型", spec: "咀嚼片" }),
  ]);
  assert.ok(spec);
  assert.equal(spec.rows.length, 2);
  assert.equal(spec.rows[0].evidenceRef, "evidence:ev-1");
  assert.equal(spec.rows[0].claimKind, "FACT", "来自真实资料的数字应标记为 FACT");

  const deep = composeDeepReport({ spec });
  const state = Object.fromEntries(deep.sections.map((s) => [s.key, s.ready]));
  assert.equal(state.definition, true, "① 块应被真实规格资料点亮");
  assert.equal(state.bom, false, "② 块无报价资料，必须保持 UNKNOWN");
});

test("P0-1: 真实报价点亮 ② BOM 块，行合计恒为标缺（无用量不算账）", () => {
  const bom = buildDeepBomFromQuotes([
    fixtureQuote({
      evidenceId: "ev-3", kind: "PRICE", item: "赤藓糖醇",
      unitPrice: 12.5, uom: "kg", moq: "500kg 起",
    }),
    fixtureQuote({ evidenceId: "ev-4", kind: "PRICE", item: "包材-瓶" }),
  ]);
  assert.ok(bom);
  assert.equal(bom.lines.length, 2);
  assert.equal(bom.lines[0].sourceRef, "evidence:ev-3");
  assert.equal(bom.lines[0].unitCost, 12.5);
  // 报价单没有用量 → 算行合计必须假设用量，那是编不是算，故一律显式标缺。
  assert.equal(bom.lines[0].total, MISSING_MARK);

  const deep = composeDeepReport({ bom });
  const state = Object.fromEntries(deep.sections.map((s) => [s.key, s.ready]));
  assert.equal(state.bom, true, "② 块应被真实报价点亮");
});

test("P0-1: 无真实资料时 ①② 块保持 UNKNOWN（不点亮、不编造）", () => {
  assert.equal(buildDeepSpecFromQuotes([]), undefined);
  assert.equal(buildDeepBomFromQuotes([]), undefined);
  const deep = composeDeepReport({
    spec: buildDeepSpecFromQuotes([]),
    bom: buildDeepBomFromQuotes([]),
  });
  assert.ok(deep.sections.every((s) => s.ready === false));
});

test("P0-1: 报价行不得凭空生成数字（无单价即标缺）", () => {
  const bom = buildDeepBomFromQuotes([
    fixtureQuote({ evidenceId: "ev-5", kind: "PRICE", item: "原料X" }),
  ]);
  assert.ok(bom);
  for (const line of bom.lines) {
    assert.equal(line.unitCost, MISSING_MARK, `不得给 ${line.item} 凭空填单价`);
    assert.equal(line.total, MISSING_MARK);
  }
});

test("P0-1: 录入行校验拒绝空 item / 负单价 / 非法日期 / 超额行", () => {
  assert.throws(() => normalizeQuoteRows("not-array"), /rows 必须是数组/);
  assert.throws(() => normalizeQuoteRows([]), /rows 不能为空/);
  assert.throws(() => normalizeQuoteRows([{ item: "   " }]), /缺少 item/);
  assert.throws(() => normalizeQuoteRows([{ item: "A", unitPrice: -1 }]), /unitPrice 不能为负数/);
  assert.throws(() => normalizeQuoteRows([{ item: "A", quotedAt: "上周" }]), /quotedAt 不是合法日期/);
  assert.throws(
    () => normalizeQuoteRows(Array.from({ length: 201 }, () => ({ item: "A" }))),
    /rows 最多 200 行/
  );

  const ok = normalizeQuoteRows([
    { item: " 赤藓糖醇 ", unitPrice: "12.5", quotedAt: "2026-10-01", spec: "食品级" },
  ]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].item, "赤藓糖醇");
  assert.equal(ok[0].unitPrice, 12.5);
  assert.ok(ok[0].quotedAt instanceof Date);
});
