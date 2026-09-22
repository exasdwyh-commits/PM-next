import type {
  DecisionEngine,
  DecisionEngineResult,
  DecisionRequest,
  DecisionSpec,
  DecisionValue,
} from "./types";

export interface RuleDecision {
  value: DecisionValue;
  reasonCodes: string[];
}

export type RuleDecisionHandler = (
  spec: DecisionSpec,
  request: DecisionRequest
) => RuleDecision | Promise<RuleDecision>;

function specId(spec: DecisionSpec): string {
  return `${spec.key}@${spec.version}`;
}

export class RulesDecisionEngine implements DecisionEngine {
  readonly kind = "RULES" as const;

  private readonly handlers = new Map<string, RuleDecisionHandler>();

  constructor(public readonly version: string = "rules-engine/v1") {}

  register(
    decisionKey: string,
    specVersion: string,
    handler: RuleDecisionHandler
  ): void {
    const key = `${decisionKey}@${specVersion}`;
    if (this.handlers.has(key)) {
      throw new Error(`Rule handler already registered: ${key}`);
    }
    this.handlers.set(key, handler);
  }

  canHandle(spec: DecisionSpec): boolean {
    return this.handlers.has(specId(spec));
  }

  async decide(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<DecisionEngineResult> {
    const handler = this.handlers.get(specId(spec));
    if (!handler) {
      throw new Error(`No rule handler for ${specId(spec)}`);
    }

    const started = performance.now();
    const decision = await handler(spec, request);
    return {
      engine: "RULES",
      engineVersion: this.version,
      value: decision.value,
      // Deterministic rules do not pretend a probability/confidence estimate.
      confidence: null,
      reasonCodes: [...decision.reasonCodes],
      latencyMs: Math.max(0, performance.now() - started),
      calibrated: false,
      calibrationProfile: null,
      benchmarkProfile: null,
      distribution: null,
    };
  }
}
