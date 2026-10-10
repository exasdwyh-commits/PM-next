/**
 * 模型调用 token 用量与成本估算 —— 纯函数模块（不访问数据库、不读环境变量）。
 *
 * 用途：回答「每次大模型调用用了多少 token、花了多少钱」。
 *   - 记录每次调用的模型、用途、输入/输出 token 数（字段名与 model-gateway 的 ModelUsage 对齐）；
 *   - 按厂商公开参考价估算美元成本；未收录定价的模型一律记为未知（null），不估算；
 *   - 汇总调用次数、token 总量与估算成本，供报告「Token 与成本统计」章节使用。
 *
 * 边界：参考价来自各厂商官方定价页公开列表价，可能调整；实际扣费以云厂商账单为准。
 * 本模块只做透明统计与估算，不产生账单数据，不臆造用量数字。
 */

/** 与 model-gateway 的 ModelUsage 字段名对齐（inputTokens / outputTokens / totalTokens）。 */
export interface TokenUsageRecordInput {
  model: string;
  purpose?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

export interface TokenUsageRecord {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 按公开参考价估算的美元成本；定价未知时为 null（不估算） */
  estimatedCostUsd: number | null;
}

export interface ModelTokenPricing {
  /** 美元 / 1k 输入 token */
  inputUsdPer1k: number;
  /** 美元 / 1k 输出 token */
  outputUsdPer1k: number;
  note: string;
}

export const TOKEN_PRICING_AS_OF = "2026-10";

/**
 * 厂商公开参考价（美元 / 1k tokens）。
 * 来源：各厂商官方定价页公开列表价，2026-10 核对；厂商可能调整，实际以账单为准。
 * 模型名按「最长前缀」匹配，带日期后缀的模型 id（如 gpt-4o-2026-06-01）可命中基础型号。
 */
export const MODEL_TOKEN_PRICING: Record<string, ModelTokenPricing> = {
  "gpt-4o": { inputUsdPer1k: 0.0025, outputUsdPer1k: 0.01, note: "OpenAI 官方参考价" },
  "gpt-4o-mini": { inputUsdPer1k: 0.00015, outputUsdPer1k: 0.0006, note: "OpenAI 官方参考价" },
  "gpt-4.1": { inputUsdPer1k: 0.002, outputUsdPer1k: 0.008, note: "OpenAI 官方参考价" },
  "gpt-4.1-mini": { inputUsdPer1k: 0.0004, outputUsdPer1k: 0.0016, note: "OpenAI 官方参考价" },
  "gpt-4.1-nano": { inputUsdPer1k: 0.0001, outputUsdPer1k: 0.0004, note: "OpenAI 官方参考价" },
  "claude-sonnet-4": { inputUsdPer1k: 0.003, outputUsdPer1k: 0.015, note: "Anthropic 官方参考价" },
  "claude-haiku-4": { inputUsdPer1k: 0.001, outputUsdPer1k: 0.005, note: "Anthropic 官方参考价" },
  "gemini-2.5-pro": { inputUsdPer1k: 0.00125, outputUsdPer1k: 0.01, note: "Google 官方参考价（≤200k 上下文）" },
  "gemini-2.5-flash": { inputUsdPer1k: 0.0003, outputUsdPer1k: 0.0025, note: "Google 官方参考价" },
  "deepseek-chat": { inputUsdPer1k: 0.00027, outputUsdPer1k: 0.0011, note: "DeepSeek 官方参考价" },
};

export interface TokenUsageSummary {
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  /** 已收录定价调用的估算成本合计（美元） */
  knownCostUsd: number;
  /** 全部调用的估算成本；任一调用定价未知或无记录时为 null */
  estimatedCostUsd: number | null;
  /** 定价未收录、未计入成本的调用次数 */
  unknownPricingCalls: number;
  byModel: Record<string, { calls: number; totalTokens: number; estimatedCostUsd: number | null }>;
}

export const TOKEN_USAGE_NOTICES: readonly string[] = [
  `参考价采自各厂商官方定价页（${TOKEN_PRICING_AS_OF} 核对），仅用于估算，实际扣费以云厂商账单为准。`,
  "未收录定价的模型不估算成本、不计入合计；用量数据来自调用方提供的记录，不由本模块臆造。",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function cleanCount(value: unknown, label: string, max = 100_000_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    fail(`${label} 必须是 0-${max} 的整数`);
  }
  return value;
}

function cleanOptionalCount(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return cleanCount(value, label);
}

/** 最长前缀匹配：gpt-4o-2026-06-01 → gpt-4o；gpt-4o-mini 优先于 gpt-4o。 */
export function resolveModelPricing(modelId: string): ModelTokenPricing | null {
  const model = (modelId ?? "").trim().toLowerCase();
  if (!model) return null;
  let best: string | null = null;
  for (const key of Object.keys(MODEL_TOKEN_PRICING)) {
    if (model === key || model.startsWith(`${key}-`) || model.startsWith(`${key}_`)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? MODEL_TOKEN_PRICING[best] : null;
}

/** 按公开参考价估算美元成本；模型定价未知时返回 null（不估算）。 */
export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = resolveModelPricing(modelId);
  if (!pricing) return null;
  const cost = (inputTokens / 1000) * pricing.inputUsdPer1k + (outputTokens / 1000) * pricing.outputUsdPer1k;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** 把一条调用记录规范化为内部结构（含成本估算）。 */
export function toTokenUsageRecord(input: TokenUsageRecordInput): TokenUsageRecord {
  if (!isRecord(input)) fail("token 用量记录必须是对象");
  const model = typeof input.model === "string" ? input.model.trim().slice(0, 120) : "";
  if (!model) fail("token 用量记录必须提供模型名（model）");
  const purpose =
    typeof input.purpose === "string" && input.purpose.trim()
      ? input.purpose.trim().slice(0, 120)
      : "未标明用途";
  const inputTokens = cleanOptionalCount(input.inputTokens, "inputTokens");
  const outputTokens = cleanOptionalCount(input.outputTokens, "outputTokens");
  const totalTokens = cleanOptionalCount(input.totalTokens, "totalTokens");
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    fail("token 用量记录至少提供 inputTokens / outputTokens / totalTokens 之一");
  }
  const prompt = inputTokens ?? 0;
  const completion = outputTokens ?? 0;
  const total = Math.max(totalTokens ?? 0, prompt + completion);
  return {
    model,
    purpose,
    inputTokens: prompt,
    outputTokens: completion,
    totalTokens: total,
    estimatedCostUsd: estimateCostUsd(model, prompt, completion),
  };
}

/** 校验并规范化一组（不受信的）token 用量输入，沿用简报模块的 fail 风格。 */
export function normalizeTokenUsageRecords(value: unknown): TokenUsageRecordInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("tokenUsage 必须是数组");
  if (value.length > 50) fail("tokenUsage 不能超过 50 条");
  return value.map((raw, index) => {
    if (!isRecord(raw)) fail(`tokenUsage 第 ${index + 1} 项必须是对象`);
    return raw as unknown as TokenUsageRecordInput;
  });
}

/** 汇总一组调用记录。 */
export function summarizeTokenUsage(records: readonly TokenUsageRecord[]): TokenUsageSummary {
  const byModel: TokenUsageSummary["byModel"] = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let knownCostUsd = 0;
  let unknownPricingCalls = 0;
  let allPriced = records.length > 0;
  for (const record of records) {
    totalInputTokens += record.inputTokens;
    totalOutputTokens += record.outputTokens;
    // 只提供 totalTokens 的记录（输入/输出拆分未知）也要计入总量
    totalTokens += record.totalTokens;
    if (record.estimatedCostUsd === null) {
      unknownPricingCalls += 1;
      allPriced = false;
    } else {
      knownCostUsd += record.estimatedCostUsd;
    }
    const entry = byModel[record.model] ?? { calls: 0, totalTokens: 0, estimatedCostUsd: 0 as number | null };
    entry.calls += 1;
    entry.totalTokens += record.totalTokens;
    if (record.estimatedCostUsd === null) {
      entry.estimatedCostUsd = null;
    } else if (typeof entry.estimatedCostUsd === "number") {
      entry.estimatedCostUsd += record.estimatedCostUsd;
    }
    byModel[record.model] = entry;
  }
  const roundedKnown = Math.round(knownCostUsd * 1_000_000) / 1_000_000;
  return {
    calls: records.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    knownCostUsd: roundedKnown,
    estimatedCostUsd: allPriced ? roundedKnown : null,
    unknownPricingCalls,
    byModel,
  };
}

/** 进程内 token 用量追踪器：记录每次模型调用的用量，可随时汇总。 */
export class TokenUsageTracker {
  private readonly records: TokenUsageRecord[] = [];

  record(input: TokenUsageRecordInput): TokenUsageRecord {
    const record = toTokenUsageRecord(input);
    this.records.push(record);
    return record;
  }

  list(): readonly TokenUsageRecord[] {
    return [...this.records];
  }

  summarize(): TokenUsageSummary {
    return summarizeTokenUsage(this.records);
  }
}

export function createTokenUsageTracker(): TokenUsageTracker {
  return new TokenUsageTracker();
}

/** 千分位格式化：确定性实现，不依赖运行时 locale（数字格式化不用带语言标签的 toLocaleString）。 */
export function formatTokenCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 美元格式化：最多 6 位小数，去掉多余的 0；小于 $0.000001 的正值写作 <$0.000001。 */
export function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (fixed === "0" || fixed === "0.") return "<$0.000001";
  return `$${fixed}`;
}

/** 一句话成本行（给执行摘要）：调用次数、token 用量、估算成本与口径说明。 */
export function formatTokenCostLine(summary: TokenUsageSummary): string {
  if (summary.calls === 0) return "未提供模型用量数据，成本统计暂缺。";
  const tokens = `${formatTokenCount(summary.totalTokens)} tokens（输入 ${formatTokenCount(summary.totalInputTokens)} / 输出 ${formatTokenCount(summary.totalOutputTokens)}）`;
  const cost =
    summary.estimatedCostUsd !== null
      ? `按公开参考价预估约 ${formatCostUsd(summary.estimatedCostUsd)}`
      : `已收录定价部分约 ${formatCostUsd(summary.knownCostUsd)}，${summary.unknownPricingCalls} 次调用定价未知未计入`;
  return `模型调用 ${summary.calls} 次，合计 ${tokens}，${cost}；实际以账单为准。`;
}

/** 多行成本统计（给「Token 与成本统计」章节）。 */
export function formatTokenUsageSummary(summary: TokenUsageSummary): string[] {
  const lines = [
    `调用次数：${summary.calls} 次；合计 ${formatTokenCount(summary.totalTokens)} tokens（输入 ${formatTokenCount(summary.totalInputTokens)} / 输出 ${formatTokenCount(summary.totalOutputTokens)}）。`,
    summary.estimatedCostUsd !== null
      ? `预估成本：约 ${formatCostUsd(summary.estimatedCostUsd)}（公开参考价，${TOKEN_PRICING_AS_OF} 核对）。`
      : `预估成本：已收录定价部分约 ${formatCostUsd(summary.knownCostUsd)}；${summary.unknownPricingCalls} 次调用模型定价未收录，未估算。`,
  ];
  const models = Object.entries(summary.byModel)
    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .slice(0, 5)
    .map(
      ([model, entry]) =>
        `${model}：${entry.calls} 次，${formatTokenCount(entry.totalTokens)} tokens${
          entry.estimatedCostUsd !== null ? `，约 ${formatCostUsd(entry.estimatedCostUsd)}` : "，定价未知"
        }`,
    );
  if (models.length > 0) lines.push(`分模型：${models.join("；")}。`);
  lines.push(...TOKEN_USAGE_NOTICES);
  return lines;
}
