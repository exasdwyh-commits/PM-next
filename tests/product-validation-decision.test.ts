import assert from "node:assert/strict";
import test from "node:test";
import {
  DO_NO_HARM_VALIDATION_POLICY,
  STRICT_PRODUCT_SIGNAL_POLICY,
  decideProductValidation,
  type ValidationMetricDefinition,
  type ValidationMetricObservation,
} from "../src/modules/product-development/validation-decision";

const definitions: ValidationMetricDefinition[] = [
  {
    key: "channel_acceptance",
    label: "渠道接受率",
    kind: "GOAL",
    direction: "AT_LEAST",
    target: 0.6,
    minSampleSize: 30,
  },
  {
    key: "repeat_intent",
    label: "复购意愿",
    kind: "GOAL",
    direction: "AT_LEAST",
    target: 0.35,
    minSampleSize: 30,
  },
  {
    key: "refund_rate",
    label: "退款率",
    kind: "GUARDRAIL",
    direction: "AT_MOST",
    target: 0.08,
    minSampleSize: 30,
  },
  {
    key: "contribution_margin",
    label: "贡献毛利率",
    kind: "GUARDRAIL",
    direction: "AT_LEAST",
    target: 0.15,
    minSampleSize: 30,
  },
];

function observations(overrides: Partial<Record<string, Partial<ValidationMetricObservation>>> = {}): ValidationMetricObservation[] {
  const base: Record<string, ValidationMetricObservation> = {
    channel_acceptance: {
      metricKey: "channel_acceptance",
      value: 0.72,
      sampleSize: 50,
      sourceRefs: ["channel-validation:1"],
    },
    repeat_intent: {
      metricKey: "repeat_intent",
      value: 0.44,
      sampleSize: 50,
      sourceRefs: ["user-followup:1"],
    },
    refund_rate: {
      metricKey: "refund_rate",
      value: 0.05,
      sampleSize: 50,
      sourceRefs: ["refund-report:1"],
    },
    contribution_margin: {
      metricKey: "contribution_margin",
      value: 0.19,
      sampleSize: 50,
      sourceRefs: ["settlement:1"],
    },
  };
  return Object.values(base).map((row) => ({
    ...row,
    ...(overrides[row.metricKey] ?? {}),
  }));
}

test("Validation Decision：目标全过且 Guardrail 无失败，观察成熟后才进入治理复核", () => {
  const result = decideProductValidation({
    definitions,
    observations: observations(),
    observationDays: 30,
    minimumObservationDays: 30,
    policy: STRICT_PRODUCT_SIGNAL_POLICY,
  });

  assert.equal(result.recommendation, "READY_FOR_GOVERNANCE_REVIEW");
  assert.equal(result.decisionRuleKey, "clear-signal");
  assert.deepEqual(result.failedGuardrailKeys, []);
  assert.deepEqual(result.unresolvedMetricKeys, []);
});

test("Validation Decision：Guardrail 失败优先于所有漂亮 Goal，并可提前停止", () => {
  const result = decideProductValidation({
    definitions,
    observations: observations({
      refund_rate: { value: 0.18 },
    }),
    observationDays: 7,
    minimumObservationDays: 30,
    policy: STRICT_PRODUCT_SIGNAL_POLICY,
  });

  assert.equal(result.recommendation, "REWORK_OR_STOP");
  assert.equal(result.decisionRuleKey, "guardrail-failure");
  assert.deepEqual(result.failedGuardrailKeys, ["refund_rate"]);
  assert.equal(result.observationMature, false);
});

test("Validation Decision：正向结果在最小观察窗口之前不能提前放行", () => {
  const result = decideProductValidation({
    definitions,
    observations: observations(),
    observationDays: 10,
    minimumObservationDays: 30,
  });

  assert.equal(result.recommendation, "CONTINUE_VALIDATION");
  assert.equal(result.observationMature, false);
});

test("Validation Decision：样本不足或缺来源保持 DATA_INCOMPLETE，不按 PASS 处理", () => {
  const result = decideProductValidation({
    definitions,
    observations: observations({
      refund_rate: { sampleSize: 12 },
      contribution_margin: { sourceRefs: [] },
    }),
    observationDays: 30,
    minimumObservationDays: 30,
  });

  assert.equal(result.recommendation, "DATA_INCOMPLETE");
  assert.ok(result.unresolvedMetricKeys.includes("refund_rate"));
  assert.ok(result.unresolvedMetricKeys.includes("contribution_margin"));
  assert.equal(
    result.metrics.find((m) => m.key === "refund_rate")?.state,
    "INSUFFICIENT"
  );
  assert.equal(
    result.metrics.find((m) => m.key === "contribution_margin")?.state,
    "UNKNOWN"
  );
});

test("Validation Decision：严格策略下 Goal 明确失败时进入重做/停止，而不是被其它指标平均", () => {
  const result = decideProductValidation({
    definitions,
    observations: observations({
      channel_acceptance: { value: 0.3 },
    }),
    observationDays: 30,
    minimumObservationDays: 30,
    policy: STRICT_PRODUCT_SIGNAL_POLICY,
  });

  assert.equal(result.recommendation, "REWORK_OR_STOP");
  assert.equal(result.decisionRuleKey, "goal-failure");
  assert.deepEqual(result.failedGoalKeys, ["channel_acceptance"]);
});

test("Validation Decision：探索策略可不把 Goal 当硬门，但仍不能越过 Guardrail", () => {
  const exploratory = decideProductValidation({
    definitions,
    observations: observations({
      channel_acceptance: { value: 0.3 },
    }),
    observationDays: 30,
    minimumObservationDays: 30,
    policy: DO_NO_HARM_VALIDATION_POLICY,
  });
  assert.equal(exploratory.recommendation, "READY_FOR_GOVERNANCE_REVIEW");

  const harmed = decideProductValidation({
    definitions,
    observations: observations({
      channel_acceptance: { value: 0.8 },
      refund_rate: { value: 0.2 },
    }),
    observationDays: 30,
    minimumObservationDays: 30,
    policy: DO_NO_HARM_VALIDATION_POLICY,
  });
  assert.equal(harmed.recommendation, "REWORK_OR_STOP");
  assert.equal(harmed.decisionRuleKey, "guardrail-failure");
});

test("Validation Decision：指标计算 ERROR 会让高优先级规则未决，低优先级正向规则不能穿透", () => {
  const result = decideProductValidation({
    definitions,
    observations: observations({
      refund_rate: { value: null, error: "refund query failed" },
    }),
    observationDays: 30,
    minimumObservationDays: 30,
  });

  assert.equal(result.recommendation, "DATA_INCOMPLETE");
  assert.equal(
    result.metrics.find((m) => m.key === "refund_rate")?.state,
    "ERROR"
  );
});
