import { ModelRegistry } from "./registry";
import { ModelRoutingError, selectModelRoute } from "./router";
import {
  InMemoryModelHealthStore,
  ModelProviderError,
  classifyModelProviderFailure,
  resolveModelFailurePolicy,
  type ModelHealthStore,
} from "./health";
import type {
  ModelExecutionAttempt,
  ModelGatewayRequest,
  ModelGatewayResult,
  ModelHealthSnapshot,
  ModelPolicy,
  ModelRouteSkip,
} from "./types";

export class ModelGatewayExecutionError extends Error {
  constructor(
    message: string,
    public readonly attempts: ModelExecutionAttempt[],
    public readonly routingSkips: ModelRouteSkip[] = []
  ) {
    super(message);
    this.name = "ModelGatewayExecutionError";
  }
}

/**
 * Provider-agnostic execution with deterministic, policy-scoped fallback.
 *
 * It deliberately does not:
 * - choose policy by itself;
 * - mutate business data;
 * - silently switch to a model outside the policy candidate list;
 * - model-hop around content-policy / request-contract / configuration failures.
 */
export class ModelGateway {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly healthStore: ModelHealthStore = new InMemoryModelHealthStore(),
    private readonly now: () => number = Date.now
  ) {}

  private async loadHealthSnapshots(): Promise<
    Map<string, ModelHealthSnapshot>
  > {
    const snapshots = new Map<string, ModelHealthSnapshot>();
    for (const profile of this.registry.listProfiles()) {
      const snapshot = await this.healthStore.get(profile.id);
      if (snapshot) snapshots.set(profile.id, snapshot);
    }
    return snapshots;
  }

  async execute(
    policy: ModelPolicy,
    request: ModelGatewayRequest
  ): Promise<ModelGatewayResult> {
    const attempts: ModelExecutionAttempt[] = [];
    const routingSkips: ModelRouteSkip[] = [];
    const excluded = new Set<string>();
    const failurePolicy = resolveModelFailurePolicy(policy.failurePolicy);

    while (true) {
      let route;
      try {
        route = selectModelRoute(
          policy,
          this.registry.listProfiles(),
          request,
          excluded,
          await this.loadHealthSnapshots(),
          this.now()
        );
        routingSkips.push(...route.skipped);
      } catch (error) {
        if (error instanceof ModelRoutingError) {
          routingSkips.push(...error.skipped);
          throw new ModelGatewayExecutionError(
            attempts.length > 0
              ? "策略内所有可用模型均执行失败、处于冷却或不满足约束"
              : error.message,
            attempts,
            routingSkips
          );
        }
        throw error;
      }

      const profile = route.selected;
      excluded.add(profile.id);

      const provider = this.registry.getProvider(profile.provider);
      if (!provider) {
        const failure = classifyModelProviderFailure(
          new ModelProviderError(
            `未注册 provider 插件：${profile.provider}`,
            "CONFIG"
          )
        );
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          success: false,
          error: failure.message,
          failureKind: failure.kind,
          fallbackAllowed: failure.fallbackAllowed,
        });
        throw new ModelGatewayExecutionError(
          "ModelProfile 已启用但 provider 插件未注册；拒绝静默 fallback",
          attempts,
          routingSkips
        );
      }

      try {
        const result = await provider.execute(profile, request);
        await this.healthStore.recordSuccess(profile.id);
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: result.modelId ?? profile.modelId,
          success: true,
        });
        return {
          ...result,
          profileId: profile.id,
          provider: profile.provider,
          resolvedModelId: result.modelId ?? profile.modelId,
          policyId: policy.id,
          policyVersion: policy.version,
          attempts,
          routingSkips,
        };
      } catch (error) {
        const failure = classifyModelProviderFailure(error);
        await this.healthStore.recordFailure(
          profile.id,
          failure,
          failurePolicy
        );
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          success: false,
          error: failure.message,
          failureKind: failure.kind,
          fallbackAllowed: failure.fallbackAllowed,
        });

        if (!failure.fallbackAllowed) {
          throw new ModelGatewayExecutionError(
            `模型调用失败且禁止 fallback：${failure.kind}`,
            attempts,
            routingSkips
          );
        }
      }
    }
  }
}
