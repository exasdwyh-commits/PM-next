/**
 * TASK-011 成本情景引擎回归锁（验证 save/compare = 计划 TEST-004 + TEST-007）
 *
 * 本测试为**纯逻辑**（无 DB 依赖）：直接调用 calcCost、compareCostScenarios，
 * 验证服务器端复算、情景对比、引擎版本记录。
 * 运行：node_modules/.bin/tsx scripts/run-test.ts tests/regression-cost-scenarios.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcCost } from "../src/modules/cost-engine/index";
import { compareCostScenarios, COST_ENGINE_VERSION } from "../src/modules/cost-engine/scenarios";
import type { CostInput, CostResult } from "../src/modules/cost-engine/types";
import type { CostScenarioRecord } from "../src/modules/cost-engine/scenarios";

/** 一个合法的最小 CostInput */
const BASE_INPUT: CostInput = {
  materialCost: 8.05,
  packagingCost: 1.2,
  manufacturingCost: 1.5,
  certificationCost: 0.3,
  platformFeeRate: 2,
  commissionRate: 40,
  marketingRate: 8,
  monthlyFixed: 5000,
  retailPrice: 69,
  channel: "XINXUAN",
  invoiceType: "达人开票",
};

function makeRecord(overrides: Partial<CostScenarioRecord> & { scenarioName: string }): CostScenarioRecord {
  const result = calcCost(BASE_INPUT);
  const { scenarioName, ...rest } = overrides;
  return {
    artifactId: "art-1",
    scenarioName,
    costInput: BASE_INPUT,
    recalculatedResult: result,
    sourceStatus: "DRAFT",
    unit: "盒",
    currency: "CNY",
    expenseBase: "出厂口径",
    engineVersion: COST_ENGINE_VERSION,
    recordedBy: "user-1",
    contentVersion: 1,
    ...rest,
  };
}

// ─────────────────────── ① calcCost 复算 ───────────────────────

test("TASK-011: calcCost 返回完整结果且引擎版本正确", () => {
  const result = calcCost(BASE_INPUT);

  assert.ok(typeof result.totalCost === "number");
  assert.ok(typeof result.netProfit === "number");
  assert.ok(typeof result.netMarginRate === "number");
  assert.ok(typeof result.bomMarginRate === "number");
  assert.ok(typeof result.breakevenUnits === "number");
  assert.ok(Array.isArray(result.alerts));
  assert.strictEqual(COST_ENGINE_VERSION, "1.0");
});

test("TASK-011: calcCost 输入不变时输出不变（确定性）", () => {
  const r1 = calcCost(BASE_INPUT);
  const r2 = calcCost(BASE_INPUT);

  assert.strictEqual(r1.totalCost, r2.totalCost);
  assert.strictEqual(r1.netProfit, r2.netProfit);
  assert.strictEqual(r1.netMarginRate, r2.netMarginRate);
});

// ─────────────────────── ② compareCostScenarios ───────────────────────

test("TASK-011: 相同情景对比无差异", () => {
  const left = makeRecord({ scenarioName: "基础" });
  const right = makeRecord({ scenarioName: "基础" });

  const diffs = compareCostScenarios(left, right);
  assert.strictEqual(diffs.length, 0);
});

test("TASK-011: 不同情景名称产生差异", () => {
  const left = makeRecord({ scenarioName: "基础" });
  const right = makeRecord({ scenarioName: "保守" });

  const diffs = compareCostScenarios(left, right);
  assert.ok(diffs.length > 0);
  assert.ok(diffs.some((d) => d.field === "scenarioName"));
});

test("TASK-011: 不同成本输入产生结果差异", () => {
  const input1: CostInput = { ...BASE_INPUT, materialCost: 8.05 };
  const input2: CostInput = { ...BASE_INPUT, materialCost: 12.00 };

  const r1 = calcCost(input1);
  const r2 = calcCost(input2);

  const left = makeRecord({ scenarioName: "A", costInput: input1, recalculatedResult: r1 });
  const right = makeRecord({ scenarioName: "A", costInput: input2, recalculatedResult: r2 });

  const diffs = compareCostScenarios(left, right);
  assert.ok(diffs.some((d) => d.field === "totalCost"));
});

// ─────────────────────── ③ 引擎版本 ───────────────────────

test("TASK-011: 引擎版本是语义化版本格式", () => {
  assert.ok(/^\d+\.\d+$/.test(COST_ENGINE_VERSION));
});
