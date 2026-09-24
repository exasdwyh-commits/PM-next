import { evaluateDecisionPolicy } from "./policy-gate";
import { validateDecisionEngineResult } from "./result-validation";
import type {
  DecisionEngine,
  DecisionExecutionResult,
  DecisionRequest,
} from "./types";
import { DecisionSpecRegistry } from "./registry";

export class DecisionIntelligenceKernel {
  private readonly engines = new Map<string, DecisionEngine>();

  constructor(private readonly specs: DecisionSpecRegistry) {}

  registerEngine(engine: DecisionEngine): void {
    if (this.engines.has(engine.kind)) {
      throw new Error(`Decision engine already registered: ${engine.kind}`);
    }
    this.engines.set(engine.kind, engine);
  }

  async decide(
    request: DecisionRequest,
    preferredEngine?: DecisionEngine["kind"]
  ): Promise<DecisionExecutionResult> {
    const spec = this.specs.get(request.decisionKey, request.specVersion);
    const order = preferredEngine
      ? [
          preferredEngine,
          ...spec.allowedEngines.filter((kind) => kind !== preferredEngine),
        ]
      : spec.allowedEngines;

    let engine: DecisionEngine | null = null;
    for (const kind of order) {
      const candidate = this.engines.get(kind);
      if (candidate?.canHandle(spec)) {
        engine = candidate;
        break;
      }
    }
    if (!engine) {
      throw new Error(
        `No registered engine can handle ${spec.key}@${spec.version}`
      );
    }

    const engineResult = await engine.decide(spec, {
      ...request,
      specVersion: spec.version,
      contextRefs: [...request.contextRefs],
    });
    validateDecisionEngineResult(spec, engineResult);

    return {
      spec,
      engineResult,
      policy: evaluateDecisionPolicy(spec, engineResult),
    };
  }
}
