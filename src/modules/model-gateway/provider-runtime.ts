import { ModelProviderError } from "./health";
import type {
  ModelProviderPlugin,
  ModelProviderResult,
  ModelGatewayRequest,
  ModelProfile,
} from "./types";

export interface OpenAICompatibleProviderRuntime {
  provider: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  source: "MODEL_PROVIDER_ENV" | "LEGACY_ADVISOR_ENV";
}

function providerEnvToken(provider: string): string {
  return provider
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Runtime credentials/endpoints live in deployment secrets, never in DB.
 *
 * Preferred convention:
 *   MODEL_PROVIDER_<PROVIDER>_BASE_URL
 *   MODEL_PROVIDER_<PROVIDER>_API_KEY
 *   MODEL_PROVIDER_<PROVIDER>_TIMEOUT_MS
 *   MODEL_PROVIDER_<PROVIDER>_MAX_TOKENS
 *   MODEL_PROVIDER_<PROVIDER>_TEMPERATURE
 *
 * Legacy ADVISOR_LLM_* vars remain a compatibility bridge only when the
 * profile provider exactly matches ADVISOR_MODEL_PROVIDER.
 */
export function resolveOpenAICompatibleProviderRuntime(
  provider: string
): OpenAICompatibleProviderRuntime | null {
  const token = providerEnvToken(provider);
  if (!token) return null;

  const prefix = `MODEL_PROVIDER_${token}_`;
  const directBaseUrl = process.env[`${prefix}BASE_URL`]?.trim().replace(/\/+$/, "");
  if (directBaseUrl) {
    return {
      provider,
      baseUrl: directBaseUrl,
      apiKey: process.env[`${prefix}API_KEY`]?.trim() || null,
      timeoutMs: positiveInt(process.env[`${prefix}TIMEOUT_MS`], 30_000),
      maxTokens: positiveInt(process.env[`${prefix}MAX_TOKENS`], 1024),
      temperature: finiteNumber(process.env[`${prefix}TEMPERATURE`], 0.2),
      source: "MODEL_PROVIDER_ENV",
    };
  }

  const legacyProvider = process.env.ADVISOR_MODEL_PROVIDER?.trim();
  const legacyBaseUrl = process.env.ADVISOR_LLM_BASE_URL?.trim().replace(/\/+$/, "");
  if (legacyProvider === provider && legacyBaseUrl) {
    return {
      provider,
      baseUrl: legacyBaseUrl,
      apiKey: process.env.ADVISOR_LLM_API_KEY?.trim() || null,
      timeoutMs: positiveInt(process.env.ADVISOR_LLM_TIMEOUT_MS, 30_000),
      maxTokens: positiveInt(process.env.ADVISOR_LLM_MAX_TOKENS, 1024),
      temperature: finiteNumber(process.env.ADVISOR_LLM_TEMPERATURE, 0.2),
      source: "LEGACY_ADVISOR_ENV",
    };
  }

  return null;
}

export function isProviderRuntimeConfigured(provider: string): boolean {
  return resolveOpenAICompatibleProviderRuntime(provider) !== null;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[\w\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/api[_-]?key[=:\s]+[\w\-._~+/]+=*/gi, "api_key=[REDACTED]")
    .replace(/sk-[\w\-._~+/]+=*/gi, "sk-[REDACTED]")
    .replace(/Authorization[^,;\n]*/gi, "Authorization=[REDACTED]")
    .slice(0, 500);
}

function failureFromHttp(status: number, body: string): ModelProviderError {
  const safe = sanitizeErrorMessage(body);
  const suffix = safe ? `：${safe}` : "";

  if (/content[_\s-]?policy|safety|moderation/i.test(body)) {
    return new ModelProviderError(
      `Provider content policy rejected request (HTTP ${status})${suffix}`,
      "CONTENT_POLICY",
      status
    );
  }
  if (status === 401 || status === 403) {
    return new ModelProviderError(
      `Provider authentication failed (HTTP ${status})${suffix}`,
      "AUTH",
      status
    );
  }
  if (status === 429) {
    return new ModelProviderError(
      `Provider rate limited request (HTTP 429)${suffix}`,
      "RATE_LIMIT",
      status
    );
  }
  if (status === 408 || status === 504) {
    return new ModelProviderError(
      `Provider request timed out (HTTP ${status})${suffix}`,
      "TIMEOUT",
      status
    );
  }
  if (status >= 500) {
    return new ModelProviderError(
      `Provider unavailable (HTTP ${status})${suffix}`,
      "SERVICE_UNAVAILABLE",
      status
    );
  }
  return new ModelProviderError(
    `Provider rejected request (HTTP ${status})${suffix}`,
    "BAD_REQUEST",
    status
  );
}

function parseUsage(raw: unknown): ModelProviderResult["usage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const inputTokens =
    typeof row.prompt_tokens === "number" ? row.prompt_tokens : undefined;
  const outputTokens =
    typeof row.completion_tokens === "number" ? row.completion_tokens : undefined;
  const totalTokens =
    typeof row.total_tokens === "number" ? row.total_tokens : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

async function executeOpenAICompatible(
  runtime: OpenAICompatibleProviderRuntime,
  profile: ModelProfile,
  request: ModelGatewayRequest
): Promise<ModelProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);

  try {
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: profile.modelId,
        messages: request.messages,
        max_tokens: runtime.maxTokens,
        temperature: runtime.temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw failureFromHttp(response.status, body);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > 1_000_000) {
      throw new ModelProviderError(
        "Provider response exceeded 1MB safety limit",
        "BAD_REQUEST"
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const first = choices[0];
    const message =
      first && typeof first === "object" && !Array.isArray(first)
        ? (first as Record<string, unknown>).message
        : null;
    const text =
      message && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>).content
        : null;

    if (typeof text !== "string" || !text.trim()) {
      throw new ModelProviderError(
        "Provider response missing non-empty choices[0].message.content",
        "CONFIG"
      );
    }
    if (text.length > 50_000) {
      throw new ModelProviderError(
        "Provider response exceeded 50,000 character limit",
        "BAD_REQUEST"
      );
    }

    return {
      text,
      modelId: typeof json.model === "string" ? json.model : profile.modelId,
      usage: parseUsage(json.usage),
      rawMetadata: {
        runtimeSource: runtime.source,
      },
    };
  } catch (error: unknown) {
    if (error instanceof ModelProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ModelProviderError(
        `Provider request timed out after ${runtime.timeoutMs}ms`,
        "TIMEOUT"
      );
    }
    throw new ModelProviderError(
      `Provider network failure: ${sanitizeErrorMessage(
        error instanceof Error ? error.message : String(error)
      )}`,
      "TRANSIENT"
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAICompatibleProviderPlugin(
  provider: string
): ModelProviderPlugin {
  return {
    provider,
    async execute(profile, request) {
      const runtime = resolveOpenAICompatibleProviderRuntime(provider);
      if (!runtime) {
        throw new ModelProviderError(
          `Provider ${provider} has no server-side runtime configuration`,
          "CONFIG"
        );
      }
      return executeOpenAICompatible(runtime, profile, request);
    },
  };
}
