/**
 * Model Gateway core contracts.
 *
 * Business modules depend on these contracts, not on concrete model vendors.
 * A model is a replaceable execution capability; Agent identity and business governance
 * must never depend on a specific provider/modelId.
 */

export type ModelTaskClass =
  | "QUICK_CLASSIFY"
  | "QUICK_RESEARCH"
  | "WEB_RESEARCH"
  | "SUMMARIZATION"
  | "STRUCTURED_EXTRACTION"
  | "PRODUCT_ANALYSIS"
  | "STRATEGIC_CONSULTING"
  | "RED_TEAM"
  | "DECISION_REVIEW"
  | "CODING";

export type ModelCapability =
  | "TEXT"
  | "VISION"
  | "TOOLS"
  | "STRUCTURED_OUTPUT"
  | "REASONING"
  | "LONG_CONTEXT";

export type ModelLocality = "CLOUD" | "LOCAL";
export type ModelHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
export type ModelQualityTier = "FAST" | "BALANCED" | "FRONTIER";
export type ModelLatencyTier = "FAST" | "NORMAL" | "SLOW";
export type ModelCostTier = "FREE" | "LOW" | "STANDARD" | "PREMIUM" | "FIXED_LOCAL";

export interface ModelProfile {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  locality: ModelLocality;
  health: ModelHealth;
  enabled: boolean;
  qualityTier: ModelQualityTier;
  latencyTier: ModelLatencyTier;
  costTier: ModelCostTier;
  contextWindow?: number | null;
  /**
   * Human-readable policy note only. It is not a legal/compliance guarantee.
   * Examples: "cloud allowed for public research", "local only for confidential inputs".
   */
  dataPolicyNote?: string | null;
}

export interface ModelPolicyCandidate {
  profileId: string;
  /**
   * Lower number = preferred earlier. Explicit priority prevents router behavior
   * from changing when new providers are registered.
   */
  priority: number;
}

export interface ModelPolicy {
  id: string;
  version: string;
  taskClass: ModelTaskClass;
  candidates: ModelPolicyCandidate[];
  requiredCapabilities: ModelCapability[];
  cloudAllowed: boolean;
  /** Optional upper bound; absence means caller did not impose one. */
  maxContextRequirement?: number | null;
}

export interface ModelGatewayMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelGatewayRequest {
  taskClass: ModelTaskClass;
  messages: ModelGatewayMessage[];
  requiredCapabilities?: ModelCapability[];
  cloudAllowed?: boolean;
  minimumContextWindow?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelProviderResult {
  text: string;
  modelId?: string;
  usage?: ModelUsage | null;
  rawMetadata?: Record<string, unknown>;
}

export interface ModelProviderPlugin {
  provider: string;
  execute(profile: ModelProfile, request: ModelGatewayRequest): Promise<ModelProviderResult>;
}

export interface ModelRouteSkip {
  profileId: string;
  reason: string;
}

export interface ModelRouteDecision {
  selected: ModelProfile;
  skipped: ModelRouteSkip[];
}

export interface ModelExecutionAttempt {
  profileId: string;
  provider: string;
  modelId: string;
  success: boolean;
  error?: string;
}

export interface ModelGatewayResult extends ModelProviderResult {
  profileId: string;
  provider: string;
  resolvedModelId: string;
  policyId: string;
  policyVersion: string;
  attempts: ModelExecutionAttempt[];
}
