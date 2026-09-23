import type {
  DecisionEngineKind,
  DecisionRequest,
  DecisionSpec,
} from "../types";
import type {
  JudgmentProvider,
  JudgmentProviderDecision,
} from "./types";

export type FakeJudgmentHandler = (
  spec: DecisionSpec,
  request: DecisionRequest
) => JudgmentProviderDecision | Promise<JudgmentProviderDecision>;

function specId(decisionKey: string, specVersion: string): string {
  return `${decisionKey}@${specVersion}`;
}

/**
 * Test/shadow provider. It has no network or paid-model side effects.
 */
export class FakeJudgmentProvider implements JudgmentProvider {
  private readonly handlers = new Map<string, FakeJudgmentHandler>();

  constructor(
    public readonly key = "fake",
    public readonly kind: DecisionEngineKind = "MODEL",
    public readonly version = "fake/v1"
  ) {}

  register(
    decisionKey: string,
    specVersion: string,
    handler: FakeJudgmentHandler
  ): void {
    const key = specId(decisionKey, specVersion);
    if (this.handlers.has(key)) {
      throw new Error(`Fake judgment handler already registered: ${key}`);
    }
    this.handlers.set(key, handler);
  }

  canHandle(spec: DecisionSpec): boolean {
    return this.handlers.has(specId(spec.key, spec.version));
  }

  async evaluate(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<JudgmentProviderDecision> {
    const handler = this.handlers.get(specId(spec.key, spec.version));
    if (!handler) {
      throw new Error(
        `No fake judgment handler for ${spec.key}@${spec.version}`
      );
    }
    return handler(spec, request);
  }
}
