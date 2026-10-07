/** Compatibility configuration; credentials remain server-side. */
export interface AdvisorLLMConfig {
  provider: string;
  modelId: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export function isAdvisorLLMEnabled(): boolean {
  const raw = process.env.ADVISOR_LLM_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

export function getAdvisorLLMConfig(): AdvisorLLMConfig {
  const provider = process.env.ADVISOR_MODEL_PROVIDER?.trim() || "openai-compatible";
  const modelId = process.env.ADVISOR_MODEL_ID?.trim() || "";
  const baseUrl =
    process.env.ADVISOR_LLM_BASE_URL?.trim().replace(/\/+$/, "") || "https://api.openai.com/v1";
  const timeoutMs = parseInt(process.env.ADVISOR_LLM_TIMEOUT_MS?.trim() || "30000", 10);
  const maxTokens = parseInt(process.env.ADVISOR_LLM_MAX_TOKENS?.trim() || "1024", 10);
  const temperature = parseFloat(process.env.ADVISOR_LLM_TEMPERATURE?.trim() || "0.2");

  return {
    provider,
    modelId,
    baseUrl,
    apiKey: process.env.ADVISOR_LLM_API_KEY?.trim() || null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 1024,
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
  };
}

