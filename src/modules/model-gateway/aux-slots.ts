/**
 * 辅助模型位（aux model slots）：按用途划分的轻量模型通道。
 *
 * C3 上下文压缩引入。用位：
 * - "summary"：滚动摘要走便宜/小模型，不占用主链路预算；
 * - "vision"：视觉理解（本阶段仅预留配置位，未接线）；
 * - "code"：代码类任务（本阶段仅预留配置位，未接线）。
 *
 * 与主链路解耦的设计（硬约束）：
 * 1. 不走 executePersistedModelGateway：不做策略路由、不记 ModelRun 账、不收 usage 费。
 *    摘要属于内部优化成本，由部署方自备该位的 API Key，自行承担；
 * 2. 配置缺失（MODEL_ID 或 BASE_URL 未配）时 resolveAuxModelSlot 返回 null，
 *    调用方必须降级为「无摘要、走原文」的旧行为，绝不抛错、不阻塞主流程；
 * 3. 不改动 types.ts 的主协议（C1 定型的 ModelGatewayRequest/Result 原样）。
 *
 * 环境变量约定（以 summary 为例，vision/code 同理把 SUMMARY 换成 VISION/CODE）：
 *   KERN_AUX_SUMMARY_MODEL_ID      模型 id（必填，否则该位禁用）
 *   KERN_AUX_SUMMARY_PROVIDER      默认 "openai-compatible"
 *   KERN_AUX_SUMMARY_BASE_URL      OpenAI 兼容 endpoint（必填，否则该位禁用）
 *   KERN_AUX_SUMMARY_API_KEY       可空
 *   KERN_AUX_SUMMARY_TIMEOUT_MS    默认 45000
 *   KERN_AUX_SUMMARY_MAX_TOKENS    默认 1024
 *   KERN_AUX_SUMMARY_TEMPERATURE   默认 0.2
 */
import {
  createOpenAICompatibleProviderPlugin,
  type OpenAICompatibleProviderRuntime,
} from "./provider-runtime";
import type { ModelGatewayMessage, ModelProfile } from "./types";

export type AuxModelPurpose = "summary" | "vision" | "code";

export interface AuxModelSlot {
  purpose: AuxModelPurpose;
  provider: string;
  modelId: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

const PURPOSE_TOKEN: Record<AuxModelPurpose, string> = {
  summary: "SUMMARY",
  vision: "VISION",
  code: "CODE",
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 解析某用途的辅助模型位。纯函数，便于单测。
 * 缺关键配置 → 返回 null（禁用），调用方降级走原文。
 */
export function resolveAuxModelSlot(purpose: AuxModelPurpose): AuxModelSlot | null {
  const token = PURPOSE_TOKEN[purpose];
  const prefix = `KERN_AUX_${token}_`;
  const modelId = process.env[`${prefix}MODEL_ID`]?.trim();
  const baseUrl = process.env[`${prefix}BASE_URL`]?.trim().replace(/\/+$/, "");
  if (!modelId || !baseUrl) return null;
  return {
    purpose,
    provider: process.env[`${prefix}PROVIDER`]?.trim() || "openai-compatible",
    modelId,
    baseUrl,
    apiKey: process.env[`${prefix}API_KEY`]?.trim() || null,
    timeoutMs: positiveInt(process.env[`${prefix}TIMEOUT_MS`], 45_000),
    maxTokens: positiveInt(process.env[`${prefix}MAX_TOKENS`], 1024),
    temperature: finiteNumber(process.env[`${prefix}TEMPERATURE`], 0.2),
  };
}

export function isAuxModelSlotConfigured(purpose: AuxModelPurpose): boolean {
  return resolveAuxModelSlot(purpose) !== null;
}

/**
 * 经辅助位直调模型（OpenAI 兼容 chat/completions）。
 * 注意：故意不走网关主链路——无策略路由、无 ModelRun 落账、无 usage 扣费，
 * 与主链路的预算/审计完全解耦。失败时抛错，由调用方捕获后降级。
 */
export async function callAuxModel(
  slot: AuxModelSlot,
  input: { system: string; user: string; signal?: AbortSignal }
): Promise<string> {
  const runtime: OpenAICompatibleProviderRuntime = {
    provider: slot.provider,
    baseUrl: slot.baseUrl,
    apiKey: slot.apiKey,
    timeoutMs: slot.timeoutMs,
    maxTokens: slot.maxTokens,
    temperature: slot.temperature,
    source: "MODEL_PROVIDER_ENV",
  };
  const plugin = createOpenAICompatibleProviderPlugin(slot.provider, { runtime });
  // 合成 profile 仅用于直调插件的 execute(profile, request) 签名，
  // 不注册进 ModelRegistry，不参与任何路由。
  const profile: ModelProfile = {
    id: `aux:${slot.purpose}`,
    provider: slot.provider,
    modelId: slot.modelId,
    displayName: `aux/${slot.purpose}`,
    capabilities: ["TEXT"],
    locality: "CLOUD",
    health: "HEALTHY",
    enabled: true,
    qualityTier: "FAST",
    latencyTier: "FAST",
    costTier: "LOW",
  };
  const messages: ModelGatewayMessage[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];
  const result = await plugin.execute(profile, {
    taskClass: "SUMMARIZATION",
    messages,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const text = result.text.trim();
  if (!text) throw new Error(`辅助模型位 ${slot.purpose} 返回空内容`);
  return text;
}
