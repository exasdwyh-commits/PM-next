import { ModelRegistry } from "./registry";
import { ModelRoutingError, selectModelRoute } from "./router";
import type {
  ModelExecutionAttempt,
  ModelGatewayRequest,
  ModelGatewayResult,
  ModelPolicy,
} from "./types";

export class ModelGatewayExecutionError extends Error {
  constructor(
    message: string,
    public readonly attempts: ModelExecutionAttempt[]
  ) {
    super(message);
    this.name = "ModelGatewayExecutionError";
  }
}

/**
 * Provider-agnostic execution with deterministic fallback.
 *
 * It deliberately does not:
 * - choose policy by itself;
 * - mutate business data;
 * - silently switch to a model outside the policy candidate list.
 */
export class ModelGateway {
  constructor(private readonly registry: ModelRegistry) {}

  async execute(
    policy: ModelPolicy,
    request: ModelGatewayRequest
  ): Promise<ModelGatewayResult> {
    const attempts: ModelExecutionAttempt[] = [];
    const excluded = new Set<string>();

    while (true) {
      let route;
      try {
        route = selectModelRoute(
          policy,
          this.registry.listProfiles(),
          request,
          excluded
        );
      } catch (error) {
        if (error instanceof ModelRoutingError) {
          throw new ModelGatewayExecutionError(
            attempts.length > 0
              ? "策略内所有可用模型均执行失败或不满足约束"
              : error.message,
            attempts
          );
        }
        throw error;
      }

      const profile = route.selected;
      excluded.add(profile.id);

      const provider = this.registry.getProvider(profile.provider);
      if (!provider) {
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          success: false,
          error: "未注册对应 provider 插件",
        });
        continue;
      }

      try {
        const result = await provider.execute(profile, request);
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
        };
      } catch (error) {
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
