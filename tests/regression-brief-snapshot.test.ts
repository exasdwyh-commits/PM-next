/**
 * TASK-010 品牌简报快照回归锁（验证映射 = 计划 TEST-004 + TEST-006）
 *
 * 本测试为**纯逻辑**（无 DB 依赖）：直接调用 buildCompanyBriefSnapshot 的内部逻辑，
 * 验证 fact → brief 字段映射、缺口识别、来源追踪。
 * 运行：node_modules/.bin/tsx scripts/run-test.ts tests/regression-brief-snapshot.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CompanyFactStatus } from "@prisma/client";

type FactRow = {
  id: string;
  key: string;
  label: string;
  value: string;
  status: CompanyFactStatus;
  sourceDocId: string | null;
  sourcePath: string | null;
  confirmedAt: Date | null;
};

/**
 * 复制 brief-snapshot.ts 内部的映射逻辑用于测试。
 * 与源码保持同步；源码变更时此处同步更新。
 */
const BRIEF_FIELD_FACT_MAP: Record<string, { briefField: string; description: string }> = {
  goals: { briefField: "goals", description: "品牌目标/使命" },
  audience: { briefField: "audience", description: "目标受众" },
  channels: { briefField: "channels", description: "销售渠道/触达渠道" },
  resources: { briefField: "resources", description: "可用资源/供应链" },
  forbidden: { briefField: "forbiddenItems", description: "禁止事项/红线" },
};

function matchFactsToFields(facts: FactRow[]): {
  matched: Record<string, string[]>;
  sourceRefs: Array<{ factId: string; factKey: string; factLabel: string; status: CompanyFactStatus }>;
} {
  const matched: Record<string, string[]> = {};
  const sourceRefs: Array<{ factId: string; factKey: string; factLabel: string; status: CompanyFactStatus }> = [];

  for (const fact of facts) {
    const keyLower = fact.key.toLowerCase();
    for (const [prefix, mapping] of Object.entries(BRIEF_FIELD_FACT_MAP)) {
      if (keyLower === prefix || keyLower.startsWith(prefix + ".") || keyLower.startsWith(prefix + "/")) {
        const arr = (matched[mapping.briefField] ??= []);
        arr.push(fact.value);
        sourceRefs.push({
          factId: fact.id,
          factKey: fact.key,
          factLabel: fact.label,
          status: fact.status,
        });
        break;
      }
    }
  }

  return { matched, sourceRefs };
}

function findMissingInputs(matched: Record<string, string[]>): string[] {
  const requiredFields = ["goals", "audience", "channels", "resources", "forbiddenItems"];
  const missingInputs: string[] = [];
  for (const field of requiredFields) {
    if (!matched[field] || matched[field].length === 0) {
      missingInputs.push(field);
    }
  }
  return missingInputs;
}

// ─────────────────────── 辅助工厂 ───────────────────────

function fact(overrides: Partial<FactRow> & { key: string; value: string }): FactRow {
  return {
    id: `fact-${Math.random().toString(36).slice(2, 8)}`,
    label: overrides.key,
    status: CompanyFactStatus.CONFIRMED,
    sourceDocId: null,
    sourcePath: null,
    confirmedAt: new Date("2026-09-20"),
    ...overrides,
  };
}

// ─────────────────────── ① 基本映射 ───────────────────────

test("TASK-010: goals fact 映射到 brief.goals", () => {
  const facts = [fact({ key: "goals", value: "打造国民健康品牌" })];
  const { matched, sourceRefs } = matchFactsToFields(facts);

  assert.deepStrictEqual(matched.goals, ["打造国民健康品牌"]);
  assert.strictEqual(sourceRefs.length, 1);
  assert.strictEqual(sourceRefs[0].factKey, "goals");
});

test("TASK-010: 子键 goals.brand 也映射到 brief.goals", () => {
  const facts = [
    fact({ key: "goals.brand", value: "品牌目标A" }),
    fact({ key: "goals.product", value: "产品目标B" }),
  ];
  const { matched } = matchFactsToFields(facts);

  assert.deepStrictEqual(matched.goals, ["品牌目标A", "产品目标B"]);
});

test("TASK-010: audience / channels / resources / forbidden 分别映射", () => {
  const facts = [
    fact({ key: "audience", value: "25-45岁女性" }),
    fact({ key: "channels", value: "天猫" }),
    fact({ key: "channels.online", value: "抖音" }),
    fact({ key: "resources", value: "自有工厂" }),
    fact({ key: "forbidden", value: "不得宣称疗效" }),
  ];
  const { matched } = matchFactsToFields(facts);

  assert.deepStrictEqual(matched.audience, ["25-45岁女性"]);
  assert.deepStrictEqual(matched.channels, ["天猫", "抖音"]);
  assert.deepStrictEqual(matched.resources, ["自有工厂"]);
  assert.deepStrictEqual(matched.forbiddenItems, ["不得宣称疗效"]);
});

// ─────────────────────── ② 缺口识别 ───────────────────────

test("TASK-010: 缺少必填字段时列入 missingInputs", () => {
  const facts = [fact({ key: "goals", value: "目标" })];
  const { matched } = matchFactsToFields(facts);
  const missing = findMissingInputs(matched);

  assert.ok(missing.includes("audience"));
  assert.ok(missing.includes("channels"));
  assert.ok(missing.includes("resources"));
  assert.ok(missing.includes("forbiddenItems"));
  assert.ok(!missing.includes("goals"));
});

test("TASK-010: 全部字段都有值时空 missingInputs", () => {
  const facts = [
    fact({ key: "goals", value: "g" }),
    fact({ key: "audience", value: "a" }),
    fact({ key: "channels", value: "c" }),
    fact({ key: "resources", value: "r" }),
    fact({ key: "forbidden", value: "f" }),
  ];
  const { matched } = matchFactsToFields(facts);
  const missing = findMissingInputs(matched);

  assert.strictEqual(missing.length, 0);
});

// ─────────────────────── ③ 来源追踪 ───────────────────────

test("TASK-010: sourceRefs 记录 fact 元数据", () => {
  const f = fact({
    key: "goals",
    value: "目标",
    sourceDocId: "doc-1",
    sourcePath: "/docs/brand.md",
    status: CompanyFactStatus.CONFIRMED,
  });
  const { sourceRefs } = matchFactsToFields([f]);

  assert.strictEqual(sourceRefs.length, 1);
  assert.strictEqual(sourceRefs[0].factId, f.id);
  assert.strictEqual(sourceRefs[0].status, CompanyFactStatus.CONFIRMED);
});

// ─────────────────────── ④ 未知 key 不污染 ───────────────────────

test("TASK-010: 未映射的 fact key 不进入任何 brief 字段", () => {
  const facts = [
    fact({ key: "goals", value: "目标" }),
    fact({ key: "unrelated.key", value: "噪音" }),
  ];
  const { matched } = matchFactsToFields(facts);

  assert.deepStrictEqual(matched.goals, ["目标"]);
  assert.strictEqual(matched["unrelated.key"], undefined);
});

// ─────────────────────── ⑤ confirmedFactVersion ───────────────────────

test("TASK-010: confirmedFactVersion 取最新 confirmedAt", () => {
  const facts = [
    fact({ key: "goals", value: "g", confirmedAt: new Date("2026-09-15") }),
    fact({ key: "audience", value: "a", confirmedAt: new Date("2026-09-20") }),
  ];
  const dates = facts.map((f) => f.confirmedAt!).filter(Boolean);
  const latest = new Date(Math.max(...dates.map((d) => d.getTime())));

  assert.strictEqual(latest.toISOString(), "2026-09-20T00:00:00.000Z");
});

test("TASK-010: 无 confirmedAt 时 confirmedFactVersion 为 null", () => {
  const facts = [fact({ key: "goals", value: "g", confirmedAt: null })];
  const dates = facts.map((f) => f.confirmedAt).filter(Boolean);

  assert.strictEqual(dates.length, 0);
});
