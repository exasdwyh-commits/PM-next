import { evaluateDecisionPolicy } from "./policy-gate";
import { validateDecisionEngineResult } from "./result-validation";
import type {
  DecisionEngine,
  DecisionExecutionResult,
  DecisionRequest,
} from "./types";
import { DecisionSpecRegistry } from "./registry";
import {
  JudgmentProviderRegistry,
  type JudgmentProviderSelection,
} from "./providers/registry";
import {
  DecisionEngineProviderAdapter,
  type JudgmentProvider,
} from "./providers/types";

export class DecisionIntelligenceKernel {
  private readonly providers = new JudgmentProviderRegistry();
  private readonly legacyEngineKinds = new Set<DecisionEngine["kind"]>();

  constructor(private readonly specs: DecisionSpecRegistry) {}

  /**
   * Backward-compatible registration for the pre-VNext DecisionEngine API.
   * Internally it is adapted into the provider-neutral registry.
   */
  registerEngine(engine: DecisionEngine): void {
    if (this.legacyEngineKinds.has(engine.kind)) {
      throw new Error(`Decision engine already registered: ${engine.kind}`);
    }
    this.legacyEngineKinds.add(engine.kind);
    this.providers.register(new DecisionEngineProviderAdapter(engine));
  }

  registerProvider(provider: JudgmentProvider): void {
    this.providers.register(provider);
  }

  async decide(
    request: DecisionRequest,
    preferredEngine?: DecisionEngine["kind"]
  ): Promise<DecisionExecutionResult> {
    return this.execute(request, { preferredEngine });
  }

  async decideWithProvider(
    request: DecisionRequest,
    preferredProviderKey: string
  ): Promise<DecisionExecutionResult> {
    return this.execute(request, { preferredProviderKey });
  }

  private async execute(
    request: DecisionRequest,
    selection: JudgmentProviderSelection
  ): Promise<DecisionExecutionResult> {
    const spec = this.specs.get(request.decisionKey, request.specVersion);
    const provider = this.providers.select(spec, selection);

    if (!provider) {
      throw new Error(
        `No registered engine can handle ${spec.key}@${spec.version}`
      );
    }

    const normalizedRequest: DecisionRequest = {
      ...request,
      specVersion: spec.version,
      contextRefs: [...request.contextRefs],
    };

    const started = performance.now();
    const providerResult = await provider.evaluate(spec, normalizedRequest);
    const measuredLatency = Math.max(0, performance.now() - started);

    const engineResult = {
      engine: provider.kind,
      engineVersion: provider.version,
      providerKey: provider.key,
      providerVersion: providerResult.providerVersion ?? provider.version,
      value: providerResult.value,
      confidence: providerResult.confidence ?? null,
      distribution: providerResult.distribution ?? null,
      reasonCodes: [...(providerResult.reasonCodes ?? [])],
      latencyMs: providerResult.latencyMs ?? measuredLatency,
      calibrated: providerResult.calibrated ?? false,
      calibrationProfile: providerResult.calibrationProfile ?? null,
      benchmarkProfile: providerResult.benchmarkProfile ?? null,
      abstained: providerResult.abstained ?? false,
      inputFingerprint: providerResult.inputFingerprint ?? null,
    };

    validateDecisionEngineResult(spec, engineResult);

    return {
      spec,
      engineResult,
      policy: evaluateDecisionPolicy(spec, engineResult),
    };
  }
}
