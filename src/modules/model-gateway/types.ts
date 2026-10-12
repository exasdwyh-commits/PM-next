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
  | "CODING"
  | "ASSISTANT_DIALOGUE"
  | "ASSISTANT_PLANNING"
  | "ASSISTANT_SYNTHESIS";

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

export type ModelFailureKind =
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "AUTH"
  | "CONFIG"
  | "BAD_REQUEST"
  | "CONTENT_POLICY"
  | "SERVICE_UNAVAILABLE"
  | "TRANSIENT"
  | "UNKNOWN";

export interface ModelFailurePolicy {
  /** Consecutive health-relevant failures before opening the circuit. */
  failureThreshold: number;
  /** Default cooldown for threshold-triggered failures. */
  cooldownMs: number;
  /** Rate limit can use a shorter/longer provider-specific cooldown. */
  rateLimitCooldownMs?: number;
  /** Auth failures usually need operator intervention; default is longer. */
  authCooldownMs?: number;
  /**
   * KX-66：RATE_LIMIT 且策略内已没有其他可用候选时，在同一模型上等待后重试的次数
   * （默认 2；0 = 不重试，直接进入冷却）。有其他候选时仍然立即 fallback。
   */
  rateLimitRetries?: number;
  /** KX-66：单次 execute 内为 RATE_LIMIT 重试累计等待的上限（默认 20 秒）。 */
  rateLimitMaxWaitMs?: number;
}

export interface ModelHealthSnapshot {
  profileId: string;
  consecutiveFailures: number;
  cooldownUntilMs: number | null;
  lastFailureKind: ModelFailureKind | null;
  lastFailureAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastError: string | null;
}

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
  /**
   * Runtime failure/cooldown policy. Omitted uses conservative gateway defaults.
   * This controls availability only; it never expands the candidate list.
   */
  failurePolicy?: ModelFailurePolicy;
}

/**
 * 原生 function calling 的工具 schema（OpenAI 兼容 `tools` 参数的 function 形式）。
 * parameters 是输入对象的 JSON Schema；provider-neutral，不绑定任何厂商方言。
 */
export interface ModelToolSchema {
  name: string;
  description: string;
  /** 输入对象的 JSON Schema。缺省结构时至少是 { type: "object" }。 */
  parameters: Record<string, unknown>;
}

/** 对话历史里「assistant 发起的原生工具调用」的传输形态（arguments 按 OpenAI 契约是 JSON 字符串）。 */
export interface ModelToolCallSpec {
  id: string;
  name: string;
  /** JSON 编码的参数对象。 */
  arguments: string;
}

/** provider 返回的一次原生工具调用（arguments 已解析为对象）。 */
export interface ModelNativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** model 返回的 arguments 不是合法 JSON 时出现；调用方应作为观察回喂而不是静默执行。 */
  argumentError?: string;
}

export interface ModelGatewayMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant 消息携带的原生工具调用（原生 function calling 历史回传）。 */
  toolCalls?: ModelToolCallSpec[];
  /** tool 消息：这条结果回答的是哪一次调用。 */
  toolCallId?: string;
}

export interface ModelGatewayRequest {
  signal?: AbortSignal;
  beforeAttempt?: () => Promise<void>;
  taskClass: ModelTaskClass;
  messages: ModelGatewayMessage[];
  requiredCapabilities?: ModelCapability[];
  cloudAllowed?: boolean;
  minimumContextWindow?: number;
  metadata?: Record<string, string | number | boolean | null>;
  /**
   * 原生 function calling 工具表（schema 形式）。
   * 未提供时请求与过去完全一致（纯文本协议）；提供时 provider 走原生 tools 参数，
   * 且路由要求候选模型具备 TOOLS 能力，否则由调用方决定回落（如文本协议）。
   */
  tools?: ModelToolSchema[];
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
  /**
   * 模型以原生 function calling 发起的工具调用。
   * 纯文本回复时缺省；纯工具调用（content 为空）时 text 为 ""。
   */
  toolCalls?: ModelNativeToolCall[];
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
  failureKind?: ModelFailureKind;
  fallbackAllowed?: boolean;
  /** KX-66：这次失败后在同一模型上等待了多久再重试（仅 RATE_LIMIT 重试时出现）。 */
  retryDelayMs?: number;
}

export interface ModelGatewayResult extends ModelProviderResult {
  profileId: string;
  provider: string;
  resolvedModelId: string;
  policyId: string;
  policyVersion: string;
  attempts: ModelExecutionAttempt[];
  /** Profiles skipped by routing, including active cooldowns. */
  routingSkips: ModelRouteSkip[];
}
