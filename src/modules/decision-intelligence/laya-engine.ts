import type {
  DecisionEngine,
  DecisionEngineResult,
  DecisionRequest,
  DecisionSpec,
  DecisionValue,
} from "./types";

/**
 * Laya is integrated as a System-1 typed decision engine.
 *
 * Persistence currently reuses the existing MODEL engine kind so the fusion can
 * remain additive. Provenance is preserved by engineVersion starting with
 * "laya-system1/". It must never be treated as a generative chat model.
 */
export interface LayaDecisionClient {
  decide(input: {
    decisionKey: string;
    outputType: DecisionSpec["outputType"];
    allowedChoices?: string[];
    minScore?: number;
    maxScore?: number;
    state: unknown;
    criteria?: unknown;
    language?: string;
  }): Promise<{
    value: DecisionValue;
    confidence: number | null;
    distribution?: Record<string, number> | null;
    reasonCodes?: string[];
    latencyMs?: number;
    calibrated?: boolean;
    calibrationProfile?: string | null;
    benchmarkProfile?: string | null;
    providerKey?: string;
    providerVersion?: string;
    abstained?: boolean;
    inputFingerprint?: string | null;
  }>;
}

function assertValue(spec: DecisionSpec, value: DecisionValue): void {
  if (spec.outputType === "BOOLEAN" && typeof value !== "boolean") {
    throw new Error("Laya returned non-boolean for BOOLEAN DecisionSpec");
  }
  if (spec.outputType === "CHOICE") {
    if (typeof value !== "string" || !spec.allowedChoices?.includes(value)) {
      throw new Error("Laya returned choice outside DecisionSpec allowlist");
    }
  }
  if (spec.outputType === "SCORE") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Laya returned non-number for SCORE DecisionSpec");
    }
    if (spec.minScore !== undefined && value < spec.minScore) {
      throw new Error("Laya score below DecisionSpec minimum");
    }
    if (spec.maxScore !== undefined && value > spec.maxScore) {
      throw new Error("Laya score above DecisionSpec maximum");
    }
  }
}

function normalizeConfidence(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Laya confidence must be null or within [0,1]");
  }
  return value;
}

export class LayaDecisionEngine implements DecisionEngine {
  readonly kind = "MODEL" as const;

  constructor(
    private readonly client: LayaDecisionClient,
    public readonly version = "laya-system1/adapter-v1"
  ) {}

  canHandle(spec: DecisionSpec): boolean {
    return spec.allowedEngines.includes("MODEL") && spec.key.startsWith("assistant.");
  }

  async decide(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<DecisionEngineResult> {
    if (!this.canHandle(spec)) {
      throw new Error(`Laya is not allowed for ${spec.key}@${spec.version}`);
    }

    const started = performance.now();
    const result = await this.client.decide({
      decisionKey: spec.key,
      outputType: spec.outputType,
      allowedChoices: spec.allowedChoices ? [...spec.allowedChoices] : undefined,
      minScore: spec.minScore,
      maxScore: spec.maxScore,
      state: request.state,
      criteria: request.criteria,
      language: request.language,
    });
    assertValue(spec, result.value);

    return {
      engine: "MODEL",
      engineVersion: this.version,
      providerKey: result.providerKey ?? "laya-system1",
      providerVersion: result.providerVersion ?? this.version,
      abstained: result.abstained === true,
      inputFingerprint: result.inputFingerprint ?? null,
      value: result.value,
      confidence: normalizeConfidence(result.confidence),
      distribution: result.distribution ?? null,
      reasonCodes: result.reasonCodes?.length
        ? [...result.reasonCodes]
        : ["LAYA_SYSTEM1_DECISION"],
      latencyMs: Math.max(
        0,
        result.latencyMs ?? performance.now() - started
      ),
      calibrated: result.calibrated === true,
      calibrationProfile: result.calibrationProfile ?? null,
      benchmarkProfile: result.benchmarkProfile ?? null,
    };
  }
}
