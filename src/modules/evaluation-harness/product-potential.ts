import {
  assessProductPotential,
  type ProductPotentialAssessment,
  type ProductPotentialInput,
  type PotentialVerdict,
} from "../product-development/potential-assessment";
import {
  buildHarnessCaseResult,
  failCheck,
  passCheck,
} from "./core";
import type {
  HarnessCaseResult,
  HarnessSeverity,
} from "./types";

export interface ProductPotentialHarnessExpectation {
  allowedVerdicts: PotentialVerdict[];
  forbiddenVerdicts?: PotentialVerdict[];
  requiredBlockerKeys?: string[];
  requiredUnknownGateKeys?: string[];
  minCoverageRatio?: number;
  maxCoverageRatio?: number;
  minDiagnosticIndex?: number;
  maxDiagnosticIndex?: number;
  /**
   * 安全用例可声明：如果存在 FAIL gate，则绝对不能输出任何推进类 verdict。
   */
  forbidProceedWhenAnyGateFails?: boolean;
}

export interface ProductPotentialHarnessCase {
  id: string;
  title: string;
  input: ProductPotentialInput;
  expected: ProductPotentialHarnessExpectation;
}

const PROCEED_VERDICTS: PotentialVerdict[] = [
  "VALIDATE",
  "PRIORITIZE_FOR_VALIDATION",
];

function rangeCheck(params: {
  key: string;
  severity: HarnessSeverity;
  label: string;
  actual: number | null;
  min?: number;
  max?: number;
}) {
  if (params.actual === null) {
    return failCheck(
      params.key,
      params.severity,
      `${params.label} 为 null，无法满足数值期望`
    );
  }
  if (params.min !== undefined && params.actual < params.min) {
    return failCheck(
      params.key,
      params.severity,
      `${params.label} 低于期望下限`,
      { min: params.min },
      params.actual
    );
  }
  if (params.max !== undefined && params.actual > params.max) {
    return failCheck(
      params.key,
      params.severity,
      `${params.label} 高于期望上限`,
      { max: params.max },
      params.actual
    );
  }
  return passCheck(
    params.key,
    params.severity,
    `${params.label} 位于期望范围`,
    { min: params.min, max: params.max },
    params.actual
  );
}

export function runProductPotentialHarnessCase(
  testCase: ProductPotentialHarnessCase
): HarnessCaseResult<ProductPotentialAssessment> {
  const output = assessProductPotential(testCase.input);
  const checks = [];

  checks.push(
    testCase.expected.allowedVerdicts.includes(output.verdict)
      ? passCheck(
          "verdict.allowed",
          "CRITICAL",
          "输出 verdict 位于允许集合",
          testCase.expected.allowedVerdicts,
          output.verdict
        )
      : failCheck(
          "verdict.allowed",
          "CRITICAL",
          "输出 verdict 不在允许集合",
          testCase.expected.allowedVerdicts,
          output.verdict
        )
  );

  if (testCase.expected.forbiddenVerdicts?.length) {
    checks.push(
      testCase.expected.forbiddenVerdicts.includes(output.verdict)
        ? failCheck(
            "verdict.forbidden",
            "CRITICAL",
            "输出命中了明确禁止的 verdict",
            testCase.expected.forbiddenVerdicts,
            output.verdict
          )
        : passCheck(
            "verdict.forbidden",
            "CRITICAL",
            "输出未命中禁止 verdict",
            testCase.expected.forbiddenVerdicts,
            output.verdict
          )
    );
  }

  for (const blockerKey of testCase.expected.requiredBlockerKeys ?? []) {
    const found = output.blockers.some((item) => item.key === blockerKey);
    checks.push(
      found
        ? passCheck(
            `blocker.${blockerKey}`,
            "CRITICAL",
            `识别到必需 blocker：${blockerKey}`
          )
        : failCheck(
            `blocker.${blockerKey}`,
            "CRITICAL",
            `遗漏必需 blocker：${blockerKey}`
          )
    );
  }

  for (const gateKey of testCase.expected.requiredUnknownGateKeys ?? []) {
    const found = output.unknownGates.some((item) => item.key === gateKey);
    checks.push(
      found
        ? passCheck(
            `unknown.${gateKey}`,
            "HIGH",
            `保留未知门槛：${gateKey}`
          )
        : failCheck(
            `unknown.${gateKey}`,
            "HIGH",
            `未知门槛被错误消失：${gateKey}`
          )
    );
  }

  if (
    testCase.expected.minCoverageRatio !== undefined ||
    testCase.expected.maxCoverageRatio !== undefined
  ) {
    checks.push(
      rangeCheck({
        key: "coverage.range",
        severity: "MEDIUM",
        label: "coverageRatio",
        actual: output.coverageRatio,
        min: testCase.expected.minCoverageRatio,
        max: testCase.expected.maxCoverageRatio,
      })
    );
  }

  if (
    testCase.expected.minDiagnosticIndex !== undefined ||
    testCase.expected.maxDiagnosticIndex !== undefined
  ) {
    checks.push(
      rangeCheck({
        key: "diagnostic.range",
        severity: "MEDIUM",
        label: "diagnosticIndex",
        actual: output.diagnosticIndex,
        min: testCase.expected.minDiagnosticIndex,
        max: testCase.expected.maxDiagnosticIndex,
      })
    );
  }

  if (testCase.expected.forbidProceedWhenAnyGateFails) {
    const hasFailGate = testCase.input.gates.some((gate) => gate.status === "FAIL");
    const unsafeProceed = hasFailGate && PROCEED_VERDICTS.includes(output.verdict);
    checks.push(
      unsafeProceed
        ? failCheck(
            "safety.fail-gate-never-proceeds",
            "CRITICAL",
            "存在 FAIL gate 时系统仍输出推进类 verdict"
          )
        : passCheck(
            "safety.fail-gate-never-proceeds",
            "CRITICAL",
            "FAIL gate 未被评分平均掉"
          )
    );
  }

  return buildHarnessCaseResult({
    caseId: testCase.id,
    title: testCase.title,
    output,
    checks,
  });
}
