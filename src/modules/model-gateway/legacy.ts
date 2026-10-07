import { getAdvisorLLMConfig, isAdvisorLLMEnabled } from "./legacy-config";
import { executePersistedModelGateway } from "./runtime";
import type { ModelGatewayMessage, ModelTaskClass, ModelProfile } from "./types";

/** Legacy settings select one profile; execution still uses the common ledger,
 * quota and cancellation gates. Credentials never enter request metadata. */
export async function executeLegacyAdvisorModel(input: {
  organizationId: string;
  agentRunId?: string;
  taskClass: ModelTaskClass;
  messages: ModelGatewayMessage[];
  signal?: AbortSignal;
  beforeAttempt?: () => Promise<void>;
  source: string;
}) {
  if (!isAdvisorLLMEnabled()) throw new Error("LLM 客户端未配置");
  const config = getAdvisorLLMConfig();
  if (!config.modelId) throw new Error("ADVISOR_LLM_ENABLED=true 但未配置 ADVISOR_MODEL_ID，无法调用模型");
  const id = `legacy:${input.organizationId}:${config.provider}:${config.modelId}`;
  const profile: ModelProfile = {
    id, provider: config.provider, modelId: config.modelId, displayName: config.modelId,
    enabled: true, health: "HEALTHY", capabilities: ["TEXT"], locality: "CLOUD",
    qualityTier: "BALANCED", latencyTier: "NORMAL", costTier: "STANDARD",
  };
  const execution = await executePersistedModelGateway({
    organizationId: input.organizationId, agentRunId: input.agentRunId,
    profiles: [profile],
    providerRuntime: { ...config, source: "LEGACY_ADVISOR_ENV" },
    policy: {
      id: "legacy-advisor", version: "1", taskClass: input.taskClass,
      candidates: [{ profileId: id, priority: 0 }], requiredCapabilities: ["TEXT"], cloudAllowed: true,
      // Preserve the old single-attempt behavior; migration adds no silent retries.
      failurePolicy: { failureThreshold: 1, cooldownMs: 0, authCooldownMs: 0, rateLimitCooldownMs: 0, rateLimitRetries: 0 },
    },
    request: { taskClass: input.taskClass, messages: input.messages, signal: input.signal, beforeAttempt: input.beforeAttempt },
    requestMeta: { source: input.source, legacyConfiguration: true },
  });
  return {
    modelRunId: execution.modelRunId, provider: execution.result.provider,
    text: execution.result.text, modelId: execution.result.resolvedModelId,
    usage: execution.result.usage ? {
      promptTokens: execution.result.usage.inputTokens,
      completionTokens: execution.result.usage.outputTokens,
      totalTokens: execution.result.usage.totalTokens,
    } : null,
  };
}
