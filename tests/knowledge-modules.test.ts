/**
 * 批次 D 契约测试：知识库四模块（结构化条规 + 事后回填）。
 *
 * 全部用例**不依赖数据库** —— provider 的映射与校验都是纯函数，
 * 与 deep-report / supplier-quotes 同构。
 *
 * 重点守住三条：
 * 1. 无来源不落库（sourceRef 必填）；
 * 2. 回填与条规**并列**呈现（共享 conflictGroup），不覆盖；
 * 3. 没匹配上的条目不出现在结果里（凑数会稀释置信度 = 假装有支撑）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { KnowledgeModule } from "@prisma/client";
import {
  backfillToItem,
  describeBackfill,
  entriesToItems,
  entryToItem,
  MODULE_SCOPES,
  queryTokens,
  matchCount,
  asAuthorityTier,
} from "../src/modules/knowledge/module-provider";
import {
  isKnowledgeModule,
  KNOWLEDGE_MODULES,
  normalizeBackfillInput,
  normalizeEntryInput,
} from "../src/modules/knowledge/module-service";
import { DEFAULT_AUTHORITY_POLICY } from "../src/modules/knowledge/authority";

/** 直接用仓库默认权威表（不读 env），断言值才稳定。 */
const POLICY = DEFAULT_AUTHORITY_POLICY;

type EntryRow = Parameters<typeof entriesToItems>[0][number];
type BackfillRow = Parameters<typeof backfillToItem>[1];

function entry(overrides: Record<string, unknown> = {}): EntryRow {
  return {
    id: "e-1",
    key: "claim.no_therapeutic",
    title: "不得宣称治疗功能",
    statement: "保健食品不得宣称治疗功能",
    scopeLabel: "保健食品",
    sourceRef: "matrix-probe:test",
    authorityTier: "curated",
    updatedAt: new Date("2026-10-11T00:00:00.000Z"),
    backfills: [],
    ...overrides,
  } as unknown as EntryRow;
}

function backfill(overrides: Record<string, unknown> = {}): BackfillRow {
  return {
    id: "b-1",
    organizationId: "org-1",
    entryId: "e-1",
    metricKey: "oem_price_range",
    numericLow: 30,
    numericHigh: 45,
    numericValue: null,
    unit: "CNY/kg",
    textValue: null,
    observedAt: new Date("2026-10-11T00:00:00.000Z"),
    sourceRef: "matrix-probe:measured",
    note: null,
    createdById: "u-1",
    createdAt: new Date("2026-10-11T00:00:00.000Z"),
    ...overrides,
  } as unknown as BackfillRow;
}

test("D-1 四个模块各自映射到独立知识域", () => {
  const scopes = KNOWLEDGE_MODULES.map((m) => MODULE_SCOPES[m]);
  assert.equal(new Set(scopes).size, 4, "四个模块的域必须互不相同");
  assert.ok(scopes.includes("compliance_redline"));
  assert.ok(scopes.includes("category_framework"));
  assert.ok(scopes.includes("channel_access"));
  assert.ok(scopes.includes("operation_sop"));
});

test("D-2 条目命中带来源锚点：uri 就是 sourceRef（引用标注可回溯）", () => {
  const item = entryToItem(entry({ sourceRef: "食品安全法 §73" }), {
    module: "COMPLIANCE_REDLINE",
    hits: 2,
    policy: POLICY,
  });
  assert.equal(item.uri, "食品安全法 §73");
  assert.equal(item.scope, "compliance_redline");
  assert.equal(item.conflictGroup, "entry:e-1");
  // 未经本轮核验，不冒充已验证来源
  assert.equal(item.verified, false);
});

test("D-3 【核心】回填与条规并列，共享 conflictGroup（不覆盖）", () => {
  const e = entry();
  const items = entriesToItems(
    [{ ...e, backfills: [backfill()] }],
    "COMPLIANCE_REDLINE",
    "治疗功能",
    10
  );
  assert.equal(items.length, 2, "条规与回填都应出现，回填不得悄悄改写条规");
  const groups = new Set(items.map((i) => i.conflictGroup));
  assert.equal(groups.size, 1, "两者必须共享同一 conflictGroup 才会被合成层识别为两种说法");
  const [rule, measured] = items;
  assert.equal(rule.ref, "entry:e-1");
  assert.equal(measured.ref, "backfill:b-1");
  // 实测是本方一手数据 → first_party
  assert.equal(measured.authorityTier, "first_party");
  assert.equal(measured.uri, "matrix-probe:measured", "回填也要带自己的来源锚点");
});

test("D-4 没匹配上的条目不进入结果（凑数 = 假装支撑）", () => {
  const items = entriesToItems([entry()], "COMPLIANCE_REDLINE", "完全不相干的查询", 10);
  assert.equal(items.length, 0);
});

test("D-5 命中数影响排序与得分", () => {
  const a = entry({ id: "e-a", title: "保健食品", statement: "不得宣称治疗功能" });
  const b = entry({ id: "e-b", title: "渠道资质", statement: "需要食品经营许可证" });
  const items = entriesToItems([a, b], "COMPLIANCE_REDLINE", "治疗功能", 10);
  assert.ok(items.length >= 1);
  assert.equal(items[0].ref, "entry:e-a", "更匹配的应排在前");
});

test("D-6 回填描述：区间 / 单值 / 原样文本 / 全空", () => {
  assert.match(describeBackfill(backfill()), /30–45 CNY\/kg/);
  assert.match(
    describeBackfill(backfill({ numericLow: null, numericHigh: null, numericValue: 7 })),
    /实测 7/
  );
  assert.match(
    describeBackfill(backfill({ numericLow: null, numericHigh: null, textValue: "30–45 天，视送检批次" })),
    /30–45 天/
  );
  assert.match(
    describeBackfill(backfill({ numericLow: null, numericHigh: null, textValue: null })),
    /未填数值/,
    "全空要如实说没填，不许编一个数"
  );
});

test("D-7 【核心】无来源不落库：条目缺 sourceRef → 拒绝", () => {
  assert.throws(
    () => normalizeEntryInput({ module: "COMPLIANCE_REDLINE", key: "k", title: "t" }),
    /sourceRef 必填/
  );
  assert.throws(
    () => normalizeBackfillInput({ metricKey: "m", observedAt: "2026-10-11T00:00:00.000Z" }),
    /sourceRef 必填/
  );
});

test("D-8 模块名与权威档走白名单，非法值拒绝", () => {
  assert.throws(
    () => normalizeEntryInput({ module: "NOT_A_MODULE", key: "k", title: "t", sourceRef: "s" }),
    /module 必须是/
  );
  assert.throws(
    () =>
      normalizeEntryInput({
        module: "COMPLIANCE_REDLINE",
        key: "k",
        title: "t",
        sourceRef: "s",
        authorityTier: "supreme",
      }),
    /authorityTier 必须是/
  );
  assert.equal(isKnowledgeModule("CHANNEL_ACCESS"), true);
  assert.equal(isKnowledgeModule("nope"), false);
});

test("D-9 回填：至少要有值，且区间必须成对", () => {
  assert.throws(
    () => normalizeBackfillInput({ metricKey: "m", sourceRef: "s", observedAt: "2026-10-11T00:00:00.000Z" }),
    /至少要有数值/
  );
  assert.throws(
    () =>
      normalizeBackfillInput({
        metricKey: "m",
        sourceRef: "s",
        observedAt: "2026-10-11T00:00:00.000Z",
        numericLow: 5,
      }),
    /成对/
  );
  assert.throws(
    () =>
      normalizeBackfillInput({
        metricKey: "m",
        sourceRef: "s",
        observedAt: "2026-10-11T00:00:00.000Z",
        numericLow: 50,
        numericHigh: 10,
      }),
    /不得大于/
  );
});

test("D-10 分词与匹配：中文二字组 + 拉丁词", () => {
  const tokens = queryTokens("宣称治疗功能 OEM");
  assert.ok(tokens.some((t) => t.length === 2), "中文按二字组切分");
  assert.ok(tokens.includes("oem"));
  assert.ok(matchCount("治疗功能", "不得宣称治疗功能") > 0);
  assert.equal(matchCount("abcd", "完全不相干"), 0);
});

test("D-11 权威档收敛：库里的字符串必须落回白名单", () => {
  assert.equal(asAuthorityTier("curated"), "curated");
  assert.equal(asAuthorityTier("first_party"), "first_party");
  assert.equal(asAuthorityTier("乱写的值"), "unknown", "未知档收敛到 unknown，不硬判");
});

test("D-12 条目 statement 可空（但会拉低可冲突性，由合成层承担）", () => {
  const out = normalizeEntryInput({
    module: "OPERATION_SOP",
    key: "k",
    title: "t",
    sourceRef: "s",
  });
  assert.equal(out.statement, undefined);
  assert.equal(out.authorityTier, "curated", "缺省档是 curated");
});
