import type {
  DecisionEngineResult,
  DecisionPolicyResult,
  DecisionSpec,
} from "./types";

const HIGH_RISK = new Set(["HIGH", "CRITICAL"]);

function escalation(spec: DecisionSpec, reason: string): DecisionPolicyResult {
  return {
    action:
      spec.automation.escalationTarget === "HUMAN"
        ? "ESCALATE_HUMAN"
        : "ESCALATE_AGENT",
    reasons: [reason],
  };
}

export function evaluateDecisionPolicy(
  spec: DecisionSpec,
  result: DecisionEngineResult
): DecisionPolicyResult {
  if (result.abstained === true) {
    return escalation(spec, "Decision provider abstained");
  }

  // Global ceiling: high/critical decisions are never autonomous, even if a
  // misconfigured spec says otherwise.
  if (HIGH_RISK.has(spec.riskClass)) {
    return escalation(
      spec,
      `Risk class ${spec.riskClass} requires escalation`
    );
  }

  switch (spec.automation.autoPolicy) {
    case "DISABLED":
      return escalation(spec, "Automatic action is disabled for this DecisionSpec");

    case "RULES_ONLY":
      if (result.engine !== "RULES") {
        return escalation(
          spec,
          "Only deterministic rules may act automatically for this DecisionSpec"
        );
      }
      return {
        action: "AUTO",
        reasons: ["Deterministic rules are explicitly allowed to auto-act"],
      };

    case "BENCHMARKED_ENGINE": {
      if (
        spec.automation.requireBenchmarkProfile &&
        !result.benchmarkProfile
      ) {
        return escalation(spec, "Missing required benchmark profile");
      }
      if (spec.automation.requireCalibrated && !result.calibrated) {
        return escalation(spec, "Engine result is not calibrated");
      }
      if (
        spec.automation.minConfidence !== undefined &&
        (result.confidence === null ||
          result.confidence < spec.automation.minConfidence)
      ) {
        return escalation(spec, "Confidence is below automatic-action threshold");
      }
      return {
        action: "AUTO",
        reasons: ["Engine satisfies benchmark/calibration/confidence policy"],
      };
    }
  }
}
