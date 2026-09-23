import type {
  DecisionExecutionResult,
  DecisionRequest,
  DecisionValue,
} from "./types";
import { DecisionIntelligenceKernel } from "./kernel";

export interface JudgmentShadowResult {
  authoritative: DecisionExecutionResult;
  shadow: DecisionExecutionResult | null;
  status: "MATCH" | "DISAGREE" | "SHADOW_FAILED";
  authoritativeValue: DecisionValue;
  shadowValue: DecisionValue | null;
  shadowError: string | null;
}

/**
 * Executes Rules first and treats that result as authoritative.
 *
 * The shadow provider is observational only: its value/policy is returned for
 * comparison but never replaces the Rules execution or triggers an action.
 */
export async function runJudgmentShadow(
  kernel: DecisionIntelligenceKernel,
  request: DecisionRequest,
  shadowProviderKey: string
): Promise<JudgmentShadowResult> {
  const authoritative = await kernel.decide(request, "RULES");
  if (authoritative.engineResult.engine !== "RULES") {
    throw new Error("Judgment shadow requires an authoritative RULES result");
  }

  try {
    const shadow = await kernel.decideWithProvider(request, shadowProviderKey);
    const match = Object.is(
      authoritative.engineResult.value,
      shadow.engineResult.value
    );
    return {
      authoritative,
      shadow,
      status: match ? "MATCH" : "DISAGREE",
      authoritativeValue: authoritative.engineResult.value,
      shadowValue: shadow.engineResult.value,
      shadowError: null,
    };
  } catch (error) {
    return {
      authoritative,
      shadow: null,
      status: "SHADOW_FAILED",
      authoritativeValue: authoritative.engineResult.value,
      shadowValue: null,
      shadowError: error instanceof Error ? error.message : "Unknown shadow error",
    };
  }
}
