/**
 * Product Validation Decision Policy
 *
 * 将“低成本验证”从一个分数升级为 Goal / Guardrail 决策框架。
 *
 * 核心不变量：
 * - Guardrail FAIL 优先于任何 Goal PASS；
 * - 没有证据、样本不足、计算错误都必须保持未决，不能当成通过；
 * - 在最小观察窗口结束前，可以因明确失败提前停止，但不能因早期好看提前放行；
 * - 本模块只给验证建议，不替代 Governance / Launch Authorization。
 */

export type ValidationMetricKind = "GOAL" | "GUARDRAIL";
export type ValidationMetricDirection = "AT_LEAST" | "AT_MOST" | "BETWEEN";

export interface ValidationMetricDefinition {
  key: string;
  label: string;
  kind: ValidationMetricKind;
  direction: ValidationMetricDirection;
  /** AT_LEAST / AT_MOST 使用 target；BETWEEN 使用 target + upperTarget。 */
  target: number;
  upperTarget?: number;
  minSampleSize: number;
  required?: boolean;
}

export interface ValidationMetricObservation {
  metricKey: string;
  value: number | null;
  sampleSize: number;
  sourceRefs: string[];
  error?: string | null;
}

export type ValidationMetricState =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "INSUFFICIENT"
  | "ERROR";

export interface ValidationMetricEvaluation {
  key: string;
  label: string;
  kind: ValidationMetricKind;
  state: ValidationMetricState;
  value: number | null;
  target: number;
  upperTarget?: number;
  sampleSize: number;
  minSampleSize: number;
  sourceRefs: string[];
  reason: string;
}

export type ValidationMetricGroup = "GOALS" | "GUARDRAILS";
export type ValidationConditionMatch = "ALL" | "ANY" | "NONE";
export type ValidationConditionState = "PASS" | "FAIL";

export interface ValidationDecisionCondition {
  group: ValidationMetricGroup;
  match: ValidationConditionMatch;
  state: ValidationConditionState;
}

export type ValidationRecommendation =
  | "REWORK_OR_STOP"
  | "READY_FOR_GOVERNANCE_REVIEW"
  | "REVIEW"
  | "CONTINUE_VALIDATION"
  | "DATA_INCOMPLETE";

export interface ValidationDecisionRule {
  key: string;
  priority: number;
  conditions: ValidationDecisionCondition[];
  action: Extract<
    ValidationRecommendation,
    "REWORK_OR_STOP" | "READY_FOR_GOVERNANCE_REVIEW" | "REVIEW"
  >;
}

export interface ValidationDecisionPolicy {
  key: string;
  version: string;
  rules: ValidationDecisionRule[];
  defaultAction: Extract<ValidationRecommendation, "REVIEW" | "REWORK_OR_STOP">;
}

export interface ProductValidationDecisionInput {
  definitions: ValidationMetricDefinition[];
  observations: ValidationMetricObservation[];
  observationDays: number;
  minimumObservationDays: number;
  policy?: ValidationDecisionPolicy;
}

export interface ProductValidationDecision {
  recommendation: ValidationRecommendation;
  policyKey: string;
  policyVersion: string;
  decisionRuleKey: string | null;
  observationMature: boolean;
  metrics: ValidationMetricEvaluation[];
  unresolvedMetricKeys: string[];
  failedGoalKeys: string[];
  failedGuardrailKeys: string[];
  reasons: string[];
}

type RuleMatchResult = "MATCHED" | "NOT_MATCHED" | "INDETERMINATE";

const UNRESOLVED = new Set<ValidationMetricState>([
  "UNKNOWN",
  "INSUFFICIENT",
  "ERROR",
]);

export const STRICT_PRODUCT_SIGNAL_POLICY: ValidationDecisionPolicy = {
  key: "STRICT_PRODUCT_SIGNAL",
  version: "validation-decision/v1",
  rules: [
    {
      key: "guardrail-failure",
      priority: 10,
      conditions: [{ group: "GUARDRAILS", match: "ANY", state: "FAIL" }],
      action: "REWORK_OR_STOP",
    },
    {
      key: "goal-failure",
      priority: 20,
      conditions: [{ group: "GOALS", match: "ANY", state: "FAIL" }],
      action: "REWORK_OR_STOP",
    },
    {
      key: "clear-signal",
      priority: 30,
      conditions: [
        { group: "GOALS", match: "ALL", state: "PASS" },
        { group: "GUARDRAILS", match: "NONE", state: "FAIL" },
      ],
      action: "READY_FOR_GOVERNANCE_REVIEW",
    },
  ],
  defaultAction: "REVIEW",
};

/**
 * 适合早期探索：Goal 暂时不作为放行硬条件，但 Guardrail 仍然是硬边界。
 * 即便 READY 也只代表“可交给治理层复核”，不直接推进产品生命周期。
 */
export const DO_NO_HARM_VALIDATION_POLICY: ValidationDecisionPolicy = {
  key: "DO_NO_HARM_VALIDATION",
  version: "validation-decision/v1",
  rules: [
    {
      key: "guardrail-failure",
      priority: 10,
      conditions: [{ group: "GUARDRAILS", match: "ANY", state: "FAIL" }],
      action: "REWORK_OR_STOP",
    },
    {
      key: "no-guardrail-harm",
      priority: 20,
      conditions: [{ group: "GUARDRAILS", match: "NONE", state: "FAIL" }],
      action: "READY_FOR_GOVERNANCE_REVIEW",
    },
  ],
  defaultAction: "REVIEW",
};

function assertMetricDefinition(def: ValidationMetricDefinition): void {
  if (!def.key.trim()) throw new Error("Validation metric key is required");
  if (!Number.isFinite(def.target)) {
    throw new Error(`Metric ${def.key} target must be finite`);
  }
  if (!Number.isInteger(def.minSampleSize) || def.minSampleSize < 1) {
    throw new Error(`Metric ${def.key} minSampleSize must be a positive integer`);
  }
  if (def.direction === "BETWEEN") {
    if (!Number.isFinite(def.upperTarget)) {
      throw new Error(`Metric ${def.key} BETWEEN requires upperTarget`);
    }
    if ((def.upperTarget as number) < def.target) {
      throw new Error(`Metric ${def.key} upperTarget must be >= target`);
    }
  }
}

function evaluateThreshold(
  def: ValidationMetricDefinition,
  value: number
): boolean {
  switch (def.direction) {
    case "AT_LEAST":
      return value >= def.target;
    case "AT_MOST":
      return value <= def.target;
    case "BETWEEN":
      return value >= def.target && value <= (def.upperTarget as number);
  }
}

export function evaluateValidationMetric(
  def: ValidationMetricDefinition,
  observation: ValidationMetricObservation | undefined
): ValidationMetricEvaluation {
  assertMetricDefinition(def);

  if (!observation) {
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      state: "UNKNOWN",
      value: null,
      target: def.target,
      upperTarget: def.upperTarget,
      sampleSize: 0,
      minSampleSize: def.minSampleSize,
      sourceRefs: [],
      reason: "没有该指标的验证观测",
    };
  }

  if (observation.metricKey !== def.key) {
    throw new Error(`Observation key mismatch for ${def.key}`);
  }

  const sourceRefs = Array.from(
    new Set(
      (observation.sourceRefs ?? [])
        .map((ref) => ref.trim())
        .filter(Boolean)
    )
  );

  if (observation.error?.trim()) {
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      state: "ERROR",
      value: observation.value,
      target: def.target,
      upperTarget: def.upperTarget,
      sampleSize: observation.sampleSize,
      minSampleSize: def.minSampleSize,
      sourceRefs,
      reason: `指标计算失败：${observation.error.trim()}`,
    };
  }

  if (
    observation.value === null ||
    !Number.isFinite(observation.value) ||
    sourceRefs.length === 0
  ) {
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      state: "UNKNOWN",
      value: observation.value,
      target: def.target,
      upperTarget: def.upperTarget,
      sampleSize: observation.sampleSize,
      minSampleSize: def.minSampleSize,
      sourceRefs,
      reason:
        sourceRefs.length === 0
          ? "缺少真实来源引用，不能把数值当成验证事实"
          : "指标值缺失或无效",
    };
  }

  if (!Number.isInteger(observation.sampleSize) || observation.sampleSize < 0) {
    throw new Error(`Metric ${def.key} sampleSize must be a non-negative integer`);
  }

  if (observation.sampleSize < def.minSampleSize) {
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      state: "INSUFFICIENT",
      value: observation.value,
      target: def.target,
      upperTarget: def.upperTarget,
      sampleSize: observation.sampleSize,
      minSampleSize: def.minSampleSize,
      sourceRefs,
      reason: `样本量 ${observation.sampleSize} 小于最低要求 ${def.minSampleSize}`,
    };
  }

  const passed = evaluateThreshold(def, observation.value);
  return {
    key: def.key,
    label: def.label,
    kind: def.kind,
    state: passed ? "PASS" : "FAIL",
    value: observation.value,
    target: def.target,
    upperTarget: def.upperTarget,
    sampleSize: observation.sampleSize,
    minSampleSize: def.minSampleSize,
    sourceRefs,
    reason: passed ? "达到预设验证阈值" : "未达到预设验证阈值",
  };
}

function conditionResult(
  condition: ValidationDecisionCondition,
  metrics: ValidationMetricEvaluation[]
): RuleMatchResult {
  const kind = condition.group === "GOALS" ? "GOAL" : "GUARDRAIL";
  const group = metrics.filter((metric) => metric.kind === kind);

  // 空组不能被“ALL/NONE”的数学真值误判为已验证通过。
  if (group.length === 0) return "INDETERMINATE";

  const desired = condition.state;
  const known = group.filter((metric) => !UNRESOLVED.has(metric.state));
  const hasUnresolved = group.some((metric) => UNRESOLVED.has(metric.state));

  switch (condition.match) {
    case "ALL":
      if (known.some((metric) => metric.state !== desired)) {
        return "NOT_MATCHED";
      }
      return hasUnresolved ? "INDETERMINATE" : "MATCHED";
    case "ANY":
      if (known.some((metric) => metric.state === desired)) {
        return "MATCHED";
      }
      return hasUnresolved ? "INDETERMINATE" : "NOT_MATCHED";
    case "NONE":
      if (known.some((metric) => metric.state === desired)) {
        return "NOT_MATCHED";
      }
      return hasUnresolved ? "INDETERMINATE" : "MATCHED";
  }
}

function ruleResult(
  rule: ValidationDecisionRule,
  metrics: ValidationMetricEvaluation[]
): RuleMatchResult {
  let unresolved = false;
  for (const condition of rule.conditions) {
    const result = conditionResult(condition, metrics);
    if (result === "NOT_MATCHED") return "NOT_MATCHED";
    if (result === "INDETERMINATE") unresolved = true;
  }
  return unresolved ? "INDETERMINATE" : "MATCHED";
}

export function decideProductValidation(
  input: ProductValidationDecisionInput
): ProductValidationDecision {
  if (!Number.isInteger(input.observationDays) || input.observationDays < 0) {
    throw new Error("observationDays must be a non-negative integer");
  }
  if (
    !Number.isInteger(input.minimumObservationDays) ||
    input.minimumObservationDays < 0
  ) {
    throw new Error("minimumObservationDays must be a non-negative integer");
  }

  const definitions = input.definitions;
  const keys = new Set<string>();
  for (const def of definitions) {
    assertMetricDefinition(def);
    if (keys.has(def.key)) throw new Error(`Duplicate metric definition: ${def.key}`);
    keys.add(def.key);
  }

  const observationMap = new Map<string, ValidationMetricObservation>();
  for (const observation of input.observations) {
    if (observationMap.has(observation.metricKey)) {
      throw new Error(`Duplicate metric observation: ${observation.metricKey}`);
    }
    if (!keys.has(observation.metricKey)) {
      throw new Error(`Unknown metric observation: ${observation.metricKey}`);
    }
    observationMap.set(observation.metricKey, observation);
  }

  const metrics = definitions.map((def) =>
    evaluateValidationMetric(def, observationMap.get(def.key))
  );
  const policy = input.policy ?? STRICT_PRODUCT_SIGNAL_POLICY;
  const observationMature =
    input.observationDays >= input.minimumObservationDays;

  const unresolvedMetricKeys = metrics
    .filter((metric) => UNRESOLVED.has(metric.state))
    .map((metric) => metric.key);
  const failedGoalKeys = metrics
    .filter((metric) => metric.kind === "GOAL" && metric.state === "FAIL")
    .map((metric) => metric.key);
  const failedGuardrailKeys = metrics
    .filter(
      (metric) => metric.kind === "GUARDRAIL" && metric.state === "FAIL"
    )
    .map((metric) => metric.key);

  const orderedRules = [...policy.rules].sort(
    (a, b) => a.priority - b.priority
  );
  let hasHigherIndeterminate = false;

  // 明确坏结果可以提前停止；明确好结果必须等观察期成熟。
  for (const rule of orderedRules) {
    const result = ruleResult(rule, metrics);
    if (result === "NOT_MATCHED") continue;
    if (result === "INDETERMINATE") {
      hasHigherIndeterminate = true;
      continue;
    }

    if (rule.action === "REWORK_OR_STOP") {
      return {
        recommendation: "REWORK_OR_STOP",
        policyKey: policy.key,
        policyVersion: policy.version,
        decisionRuleKey: rule.key,
        observationMature,
        metrics,
        unresolvedMetricKeys,
        failedGoalKeys,
        failedGuardrailKeys,
        reasons: [
          `命中阻断规则：${rule.key}`,
          ...(failedGuardrailKeys.length
            ? [`Guardrail 失败：${failedGuardrailKeys.join("、")}`]
            : []),
          ...(failedGoalKeys.length
            ? [`Goal 失败：${failedGoalKeys.join("、")}`]
            : []),
        ],
      };
    }

    if (!observationMature) {
      return {
        recommendation: "CONTINUE_VALIDATION",
        policyKey: policy.key,
        policyVersion: policy.version,
        decisionRuleKey: null,
        observationMature,
        metrics,
        unresolvedMetricKeys,
        failedGoalKeys,
        failedGuardrailKeys,
        reasons: [
          `观察窗口仅 ${input.observationDays} 天，未达到最低 ${input.minimumObservationDays} 天；正向结果不能提前放行`,
        ],
      };
    }

    if (hasHigherIndeterminate) {
      return {
        recommendation: "DATA_INCOMPLETE",
        policyKey: policy.key,
        policyVersion: policy.version,
        decisionRuleKey: null,
        observationMature,
        metrics,
        unresolvedMetricKeys,
        failedGoalKeys,
        failedGuardrailKeys,
        reasons: [
          "更高优先级规则存在未决指标，不能被较低优先级的正向规则覆盖",
          ...(unresolvedMetricKeys.length
            ? [`未决指标：${unresolvedMetricKeys.join("、")}`]
            : []),
        ],
      };
    }

    return {
      recommendation: rule.action,
      policyKey: policy.key,
      policyVersion: policy.version,
      decisionRuleKey: rule.key,
      observationMature,
      metrics,
      unresolvedMetricKeys,
      failedGoalKeys,
      failedGuardrailKeys,
      reasons: [`命中验证规则：${rule.key}`],
    };
  }

  if (!observationMature) {
    return {
      recommendation: "CONTINUE_VALIDATION",
      policyKey: policy.key,
      policyVersion: policy.version,
      decisionRuleKey: null,
      observationMature,
      metrics,
      unresolvedMetricKeys,
      failedGoalKeys,
      failedGuardrailKeys,
      reasons: [
        `观察窗口未成熟：${input.observationDays}/${input.minimumObservationDays} 天`,
      ],
    };
  }

  if (unresolvedMetricKeys.length > 0 || hasHigherIndeterminate) {
    return {
      recommendation: "DATA_INCOMPLETE",
      policyKey: policy.key,
      policyVersion: policy.version,
      decisionRuleKey: null,
      observationMature,
      metrics,
      unresolvedMetricKeys,
      failedGoalKeys,
      failedGuardrailKeys,
      reasons: [`未决指标：${unresolvedMetricKeys.join("、") || "规则条件未决"}`],
    };
  }

  return {
    recommendation: policy.defaultAction,
    policyKey: policy.key,
    policyVersion: policy.version,
    decisionRuleKey: null,
    observationMature,
    metrics,
    unresolvedMetricKeys,
    failedGoalKeys,
    failedGuardrailKeys,
    reasons: ["没有命中明确规则，进入人工复核"],
  };
}
