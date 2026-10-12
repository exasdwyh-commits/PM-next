import { ModelProviderError } from "./health";
import type {
  ModelProviderPlugin,
  ModelProviderResult,
  ModelGatewayRequest,
  ModelNativeToolCall,
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

function sanitizeErrorMessage(message: string, apiKey?: string | null): string {
  const redacted = apiKey ? message.split(apiKey).join("[REDACTED]") : message;
  return redacted
    .replace(/Bearer\s+[\w\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/api[_-]?key[=:\s]+[\w\-._~+/]+=*/gi, "api_key=[REDACTED]")
    .replace(/sk-[\w\-._~+/]+=*/gi, "sk-[REDACTED]")
    .replace(/Authorization[^,;\n]*/gi, "Authorization=[REDACTED]")
    .slice(0, 500);
}

/** Retry-After 可以是秒数或 HTTP 日期；解析不了就返回 undefined。 */
export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

function failureFromHttp(status: number, body: string, retryAfter: string | null = null, apiKey?: string | null): ModelProviderError {
  const safe = sanitizeErrorMessage(body, apiKey);
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
      status,
      parseRetryAfterMs(retryAfter)
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

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseUsage(raw: unknown): ModelProviderResult["usage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const inputTokens =
    validTokenCount(row.prompt_tokens) ? row.prompt_tokens : undefined;
  const outputTokens =
    validTokenCount(row.completion_tokens) ? row.completion_tokens : undefined;
  const totalTokens =
    validTokenCount(row.total_tokens) ? row.total_tokens : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/** 把网关消息映射成 OpenAI 兼容 provider 的 messages 元素（无工具字段时与旧行为逐字节一致）。 */
function toProviderMessages(request: ModelGatewayRequest): Record<string, unknown>[] {
  return request.messages.map((m) => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.role === "tool" && m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.toolCalls?.length) {
      msg.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    return msg;
  });
}

/** 解析 provider 返回的 message.tool_calls（缺失/畸形都按“没有原生调用”处理，不抛）。 */
function parseNativeToolCalls(raw: unknown): ModelNativeToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: ModelNativeToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" && row.id ? row.id : `call_${calls.length + 1}`;
    const fn = row.function;
    const name =
      fn && typeof fn === "object" && !Array.isArray(fn) && typeof (fn as Record<string, unknown>).name === "string"
        ? ((fn as Record<string, unknown>).name as string)
        : "";
    if (!name) continue;
    const rawArgs =
      fn && typeof fn === "object" && !Array.isArray(fn) ? (fn as Record<string, unknown>).arguments : undefined;
    let args: Record<string, unknown> = {};
    let argumentError: string | undefined;
    if (typeof rawArgs === "string" && rawArgs.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) argumentError = "arguments 不是 JSON 对象";
      } catch {
        argumentError = "arguments 不是合法 JSON";
      }
    } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
      // 少数兼容端点直接返回对象
      args = rawArgs as Record<string, unknown>;
    }
    calls.push({ id, name, arguments: args, ...(argumentError ? { argumentError } : {}) });
  }
  return calls.length ? calls : undefined;
}

async function executeOpenAICompatible(
  runtime: OpenAICompatibleProviderRuntime,
  profile: ModelProfile,
  request: ModelGatewayRequest,
  beforeTransport?: () => Promise<void>
): Promise<ModelProviderResult> {
  request.signal?.throwIfAborted();
  await beforeTransport?.();
  request.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);

  const hasTools = !!request.tools?.length;
  try {
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: profile.modelId,
        messages: toProviderMessages(request),
        max_tokens: runtime.maxTokens,
        temperature: runtime.temperature,
        ...(hasTools
          ? {
              tools: request.tools!.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
              tool_choice: "auto",
            }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw failureFromHttp(response.status, body, response.headers.get("retry-after"), runtime.apiKey);
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
    const messageRow =
      message && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>)
        : null;
    const rawContent = messageRow?.content;
    const text = typeof rawContent === "string" ? rawContent : "";
    const toolCalls = parseNativeToolCalls(messageRow?.tool_calls);

    if (!text.trim() && !toolCalls) {
      throw new ModelProviderError(
        // 推理模型把 max_tokens 耗在思考上时 content 为空：属可重试/可 fallback，而非配置错误（KX-65）
        // 原生工具调用（content 为空但带 tool_calls）是合法回复，不算空。
        "Provider response missing non-empty choices[0].message.content",
        "TRANSIENT"
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
      ...(toolCalls ? { toolCalls } : {}),
    };
  } catch (error: unknown) {
    request.signal?.throwIfAborted();
    if (error instanceof ModelProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ModelProviderError(
        `模型请求超时（timeout，${runtime.timeoutMs}ms）`,
        "TIMEOUT"
      );
    }
    throw new ModelProviderError(
      `Provider network failure: ${sanitizeErrorMessage(
        error instanceof Error ? error.message : String(error), runtime.apiKey
      )}`,
      "TRANSIENT"
    );
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}

export function createOpenAICompatibleProviderPlugin(
  provider: string,
  options?: { runtime?: OpenAICompatibleProviderRuntime; beforeTransport?: () => Promise<void> }
): ModelProviderPlugin {
  return {
    provider,
    async execute(profile, request) {
      const runtime = options?.runtime ?? resolveOpenAICompatibleProviderRuntime(provider);
      if (runtime && runtime.provider !== provider) throw new Error("Provider runtime mismatch");
      if (!runtime) {
        throw new ModelProviderError(
          `Provider ${provider} has no server-side runtime configuration`,
          "CONFIG"
        );
      }
      return executeOpenAICompatible(runtime, profile, request, options?.beforeTransport);
    },
  };
}
