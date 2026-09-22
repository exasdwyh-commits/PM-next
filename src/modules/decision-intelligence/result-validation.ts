import type { DecisionEngineResult, DecisionSpec } from "./types";

export function validateDecisionEngineResult(
  spec: DecisionSpec,
  result: DecisionEngineResult
): void {
  if (!spec.allowedEngines.includes(result.engine)) {
    throw new Error(
      `Engine ${result.engine} is not allowed for ${spec.key}@${spec.version}`
    );
  }

  if (result.confidence !== null) {
    if (
      !Number.isFinite(result.confidence) ||
      result.confidence < 0 ||
      result.confidence > 1
    ) {
      throw new Error("Decision confidence must be null or between 0 and 1");
    }
  }

  switch (spec.outputType) {
    case "BOOLEAN":
      if (typeof result.value !== "boolean") {
        throw new Error(`Decision ${spec.key} requires boolean output`);
      }
      break;
    case "CHOICE":
      if (typeof result.value !== "string") {
        throw new Error(`Decision ${spec.key} requires string choice output`);
      }
      if (
        !spec.allowedChoices?.length ||
        !spec.allowedChoices.includes(result.value)
      ) {
        throw new Error(
          `Decision ${spec.key} returned disallowed choice: ${String(result.value)}`
        );
      }
      break;
    case "SCORE":
      if (typeof result.value !== "number" || !Number.isFinite(result.value)) {
        throw new Error(`Decision ${spec.key} requires finite numeric output`);
      }
      if (spec.minScore !== undefined && result.value < spec.minScore) {
        throw new Error(`Decision ${spec.key} score below minimum`);
      }
      if (spec.maxScore !== undefined && result.value > spec.maxScore) {
        throw new Error(`Decision ${spec.key} score above maximum`);
      }
      break;
  }
}
