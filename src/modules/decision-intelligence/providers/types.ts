import type {
  DecisionEngine,
  DecisionEngineKind,
  DecisionEngineResult,
  DecisionRequest,
  DecisionSpec,
  DecisionValue,
} from "../types";

export interface JudgmentProviderDecision {
  value: DecisionValue;
  /** Per-run runtime/checkpoint provenance; falls back to provider.version. */
  providerVersion?: string;
  confidence?: number | null;
  distribution?: Record<string, number> | null;
  reasonCodes?: string[];
  latencyMs?: number;
  calibrated?: boolean;
  calibrationProfile?: string | null;
  benchmarkProfile?: string | null;
  abstained?: boolean;
  inputFingerprint?: string | null;
}

export interface JudgmentProvider {
  readonly key: string;
  readonly kind: DecisionEngineKind;
  readonly version: string;
  canHandle(spec: DecisionSpec): boolean;
  evaluate(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<JudgmentProviderDecision>;
}

/**
 * Compatibility bridge for the pre-VNext DecisionEngine contract.
 *
 * Existing rules/model engines remain valid while VNext moves provider
 * selection to provider keys instead of assuming one implementation per kind.
 */
export class DecisionEngineProviderAdapter implements JudgmentProvider {
  constructor(
    private readonly engine: DecisionEngine,
    public readonly key = `legacy:${engine.kind.toLowerCase()}`
  ) {}

  get kind(): DecisionEngineKind {
    return this.engine.kind;
  }

  get version(): string {
    return this.engine.version;
  }

  canHandle(spec: DecisionSpec): boolean {
    return this.engine.canHandle(spec);
  }

  async evaluate(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<JudgmentProviderDecision> {
    const result: DecisionEngineResult = await this.engine.decide(spec, request);
    return {
      value: result.value,
      confidence: result.confidence,
      distribution: result.distribution ?? null,
      reasonCodes: [...result.reasonCodes],
      latencyMs: result.latencyMs,
      calibrated: result.calibrated,
      calibrationProfile: result.calibrationProfile,
      benchmarkProfile: result.benchmarkProfile,
      abstained: result.abstained ?? false,
      inputFingerprint: result.inputFingerprint ?? null,
      providerVersion: result.providerVersion ?? result.engineVersion,
    };
  }
}
