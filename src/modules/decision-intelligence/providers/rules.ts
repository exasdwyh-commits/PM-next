import { RulesDecisionEngine, type RuleDecisionHandler } from "../rules-engine";
import type { DecisionRequest, DecisionSpec } from "../types";
import type {
  JudgmentProvider,
  JudgmentProviderDecision,
} from "./types";

export class RulesJudgmentProvider implements JudgmentProvider {
  readonly kind = "RULES" as const;

  constructor(
    private readonly engine = new RulesDecisionEngine(),
    public readonly key = "rules",
    public readonly version = engine.version
  ) {}

  register(
    decisionKey: string,
    specVersion: string,
    handler: RuleDecisionHandler
  ): void {
    this.engine.register(decisionKey, specVersion, handler);
  }

  canHandle(spec: DecisionSpec): boolean {
    return this.engine.canHandle(spec);
  }

  async evaluate(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<JudgmentProviderDecision> {
    const result = await this.engine.decide(spec, request);
    return {
      value: result.value,
      confidence: result.confidence,
      distribution: result.distribution ?? null,
      reasonCodes: [...result.reasonCodes],
      latencyMs: result.latencyMs,
      calibrated: result.calibrated,
      calibrationProfile: result.calibrationProfile,
      benchmarkProfile: result.benchmarkProfile,
      abstained: false,
      inputFingerprint: result.inputFingerprint ?? null,
    };
  }
}
