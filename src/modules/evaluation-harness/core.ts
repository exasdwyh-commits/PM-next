import type {
  HarnessCaseResult,
  HarnessCheck,
  HarnessSuiteResult,
} from "./types";

export function summarizeHarnessSuite<TOutput>(
  suiteId: string,
  results: Array<HarnessCaseResult<TOutput>>
): HarnessSuiteResult<TOutput> {
  const passedCases = results.filter((result) => result.passed).length;
  return {
    suiteId,
    caseCount: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    criticalFailures: results.reduce(
      (sum, result) => sum + result.criticalFailures,
      0
    ),
    results,
  };
}

export function buildHarnessCaseResult<TOutput>(input: {
  caseId: string;
  title: string;
  output: TOutput;
  checks: HarnessCheck[];
}): HarnessCaseResult<TOutput> {
  const criticalFailures = input.checks.filter(
    (check) => check.status === "FAIL" && check.severity === "CRITICAL"
  ).length;
  const passed = input.checks.every(
    (check) => check.status !== "FAIL"
  );

  return {
    caseId: input.caseId,
    title: input.title,
    output: input.output,
    checks: input.checks,
    passed,
    criticalFailures,
  };
}

export function passCheck(
  key: string,
  severity: HarnessCheck["severity"],
  message: string,
  expected?: unknown,
  actual?: unknown
): HarnessCheck {
  return { key, status: "PASS", severity, message, expected, actual };
}

export function failCheck(
  key: string,
  severity: HarnessCheck["severity"],
  message: string,
  expected?: unknown,
  actual?: unknown
): HarnessCheck {
  return { key, status: "FAIL", severity, message, expected, actual };
}

export function skipCheck(
  key: string,
  severity: HarnessCheck["severity"],
  message: string
): HarnessCheck {
  return { key, status: "SKIP", severity, message };
}
