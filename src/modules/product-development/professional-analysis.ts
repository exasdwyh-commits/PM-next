/**
 * 专业分析草稿生成（TASK-015；计划 §1.9 / 契约「结构化成果与门禁契约」B 节）
 *
 * 本模块调用现有 LLM 适配器生成专业分析草稿：
 * 1. 接收授权分析上下文（TASK-014）
 * 2. 构建专业分析提示词（版本化，不直接放宽现有"300 字解释工具数据"提示词）
 * 3. 调用 LLM 适配器（复用 TASK-013 的 AbortSignal 支持）
 * 4. 校验输出结构（schema、引用归属、金额来源、非法动作）
 * 5. 引用不合法、金额无对应成本引用、出现未授权动作或输出无法解析均不采纳
 * 6. 失败保留可理解原因
 *
 * 未接真实模型时返回默认分析（NEEDS_EVIDENCE），不伪称 AI 分析。
 */

import { SessionContext } from "../identity/session";
import { createAdvisorLLMClient, isAdvisorLLMEnabled } from "../advisor/llm";
import type { AuthorizedAnalysisContext } from "../advisor/context";
import {
  type ProfessionalAnalysisV1,
  type AnalysisConclusion,
  type ClaimLevel,
  type AnalysisClaim,
  type AnalysisRisk,
  type AnalysisRecommendedAction,
  validateProfessionalAnalysis,
  createDefaultAnalysis,
  PROFESSIONAL_ANALYSIS_VERSION,
} from "./professional-analysis-schema";

// ── 常量 ──

/** 专业分析提示词版本（每次修改提示词时递增） */
export const PROFESSIONAL_ANALYSIS_PROMPT_VERSION = "1.0";

// ── 类型 ──

/** 生成专业分析草稿的输入 */
export interface GenerateProfessionalAnalysisInput {
  session: SessionContext;
  /** 授权分析上下文（来自 TASK-014） */
  context: AuthorizedAnalysisContext;
  /** 产品 ID */
  productId: string;
  /** 产品版本 ID */
  productVersionId: string;
  /** 中止信号（可选） */
  signal?: AbortSignal;
}

/** 生成专业分析草稿的输出 */
export interface GenerateProfessionalAnalysisOutput {
  /** 专业分析草稿（V1 结构） */
  analysis: ProfessionalAnalysisV1;
  /** 是否为 LLM 生成（false = 规则回退/默认） */
  isLLMGenerated: boolean;
  /** 失败原因（如果生成失败） */
  failureReason?: string;
  /** 提示词版本 */
  promptVersion: string;
}

// ── 提示词构建 ──

/**
 * 构建专业分析系统提示词
 */
function buildSystemPrompt(): string {
  return `你是一位专业的产品分析助手。你的任务是基于提供的授权上下文，生成专业的产品分析报告。

**核心原则：**
1. 所有引用必须来自本次授权上下文的引用白名单（citationWhitelist）
2. 不让模型凭空填写责任人 ID 或已批准金额
3. 没有证据时输出不足，不凑路线数量
4. 金额主张必须有对应的成本情景引用
5. 不执行模型输出的任意代码

**输出格式（JSON）：**
{
  "schemaVersion": "${PROFESSIONAL_ANALYSIS_VERSION}",
  "conclusion": "PROCEED_TO_VALIDATE | NEEDS_EVIDENCE | PAUSE | REJECT",
  "summary": "200-500 字总结",
  "companyFit": ["适配度评估点"],
  "claims": [
    {
      "content": "主张内容",
      "level": "FACT | INFERENCE | ASSUMPTION",
      "sourceRefs": ["ref-id"]
    }
  ],
  "alternatives": ["替代方案"],
  "economicScenarioRef": "cost-scenario-id 或 null",
  "risks": [
    {
      "description": "风险描述",
      "severity": "HIGH | MEDIUM | LOW",
      "mitigation": "缓解措施（可选）"
    }
  ],
  "unknowns": ["未知项"],
  "recommendedActions": [
    {
      "action": "动作描述",
      "priority": "HIGH | MEDIUM | LOW",
      "owner": "负责方（可选，不允许填写具体人名/ID）"
    }
  ],
  "limitations": ["局限性说明"]
}

**结论选择指南：**
- PROCEED_TO_VALIDATE: 证据充分，可以进入验证阶段
- NEEDS_EVIDENCE: 需要补充更多证据才能做出判断
- PAUSE: 风险过高或信息不足，建议暂停
- REJECT: 方案不可行，建议拒绝

**主张分级指南：**
- FACT: 已验证的事实（有明确来源）
- INFERENCE: 合理推断（基于事实的逻辑推理）
- ASSUMPTION: 假设（未经验证的推测）`;
}

/**
 * 构建专业分析用户提示词
 */
function buildUserPrompt(context: AuthorizedAnalysisContext): string {
  const parts: string[] = [];

  parts.push("请基于以下授权上下文，生成专业的产品分析报告：\n");

  // 公司简报
  if (context.companyBrief) {
    parts.push("## 公司简报");
    parts.push(`- 目标: ${(context.companyBrief.businessInput.goals as string[])?.join(", ") || "未设置"}`);
    parts.push(`- 受众: ${(context.companyBrief.businessInput.audience as string[])?.join(", ") || "未设置"}`);
    parts.push(`- 渠道: ${(context.companyBrief.businessInput.channels as string[])?.join(", ") || "未设置"}`);
    parts.push("");
  }

  // 产品版本
  if (context.productVersion) {
    parts.push("## 产品版本");
    parts.push(`- 版本: ${context.productVersion.versionTag}`);
    parts.push(`- 目标成本: ${context.productVersion.targetCost ?? "未设置"} ${context.productVersion.currency}`);
    parts.push("");
  }

  // 证据
  if (context.evidence.length > 0) {
    parts.push("## 可用证据");
    for (const ev of context.evidence.slice(0, 5)) {
      parts.push(`- [${ev.nature}/${ev.verifyStatus}] ${ev.source}: ${ev.snippet}`);
    }
    parts.push("");
  }

  // 成本情景
  if (context.costScenarios.length > 0) {
    parts.push("## 成本情景");
    for (const cs of context.costScenarios) {
      parts.push(`- ${cs.label}: 总成本 ${cs.totalCost ?? "未知"} ${cs.currency} (引擎版本: ${cs.engineVersion})`);
    }
    parts.push("");
  }

  // 历史决定
  if (context.decisions.length > 0) {
    parts.push("## 历史决定");
    for (const d of context.decisions.slice(0, 3)) {
      parts.push(`- ${d.gate}: ${d.decision} - ${d.reason}`);
    }
    parts.push("");
  }

  // 引用白名单
  parts.push("## 引用白名单（只能使用这些 ref）");
  for (const cit of context.citationWhitelist) {
    parts.push(`- ${cit.ref} (${cit.kind}): ${cit.label}`);
  }
  parts.push("");

  // 截断记录
  if (context.truncations.length > 0) {
    parts.push("## 注意事项");
    for (const t of context.truncations) {
      parts.push(`- ${t.section}: ${t.reason}`);
    }
    parts.push("");
  }

  parts.push("请按照系统提示词要求的 JSON 格式输出分析结果。");

  return parts.join("\n");
}

// ── LLM 调用 ──

/**
 * 调用 LLM 生成专业分析草稿
 */
async function callLLMForAnalysis(
  context: AuthorizedAnalysisContext,
  signal?: AbortSignal
): Promise<{ text: string; usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null }> {
  const client = createAdvisorLLMClient();
  if (!client) {
    throw new Error("LLM 客户端未配置");
  }
  const messages = [
    { role: "system" as const, content: buildSystemPrompt() },
    { role: "user" as const, content: buildUserPrompt(context) },
  ];

  return client.chat(messages, signal);
}

// ── 解析与校验 ──

/**
 * 从 LLM 输出解析专业分析结构
 */
function parseAnalysisFromLLMOutput(text: string): ProfessionalAnalysisV1 | null {
  try {
    // 尝试提取 JSON（可能被 markdown 代码块包裹）
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);

    // 校验必需字段
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.schemaVersion !== "string" ||
      typeof parsed.conclusion !== "string" ||
      typeof parsed.summary !== "string"
    ) {
      return null;
    }

    // 构建完整的分析结构
    return {
      schemaVersion: parsed.schemaVersion,
      conclusion: parsed.conclusion as AnalysisConclusion,
      summary: parsed.summary,
      companyFit: Array.isArray(parsed.companyFit) ? parsed.companyFit : [],
      claims: Array.isArray(parsed.claims)
        ? parsed.claims.map((c: any) => ({
            content: String(c.content ?? ""),
            level: (["FACT", "INFERENCE", "ASSUMPTION"].includes(c.level) ? c.level : "ASSUMPTION") as ClaimLevel,
            sourceRefs: Array.isArray(c.sourceRefs) ? c.sourceRefs : [],
          }))
        : [],
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      economicScenarioRef: parsed.economicScenarioRef ?? null,
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.map((r: any) => ({
            description: String(r.description ?? ""),
            severity: (["HIGH", "MEDIUM", "LOW"].includes(r.severity) ? r.severity : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
            mitigation: r.mitigation ? String(r.mitigation) : undefined,
          }))
        : [],
      unknowns: Array.isArray(parsed.unknowns) ? parsed.unknowns : [],
      recommendedActions: Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.map((a: any) => ({
            action: String(a.action ?? ""),
            priority: (["HIGH", "MEDIUM", "LOW"].includes(a.priority) ? a.priority : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
            owner: a.owner ? String(a.owner) : undefined,
          }))
        : [],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
    };
  } catch {
    return null;
  }
}

// ── 主函数 ──

/**
 * 生成专业分析草稿
 *
 * 1. 接收授权分析上下文
 * 2. 构建专业分析提示词
 * 3. 调用 LLM 适配器
 * 4. 校验输出结构
 * 5. 引用不合法、金额无对应成本引用、出现未授权动作或输出无法解析均不采纳
 * 6. 失败保留可理解原因
 */
export async function generateProfessionalAnalysisDraft(
  input: GenerateProfessionalAnalysisInput
): Promise<GenerateProfessionalAnalysisOutput> {
  const { context, signal } = input;
  const promptVersion = PROFESSIONAL_ANALYSIS_PROMPT_VERSION;

  // 1. 检查 LLM 是否可用
  if (!isAdvisorLLMEnabled()) {
    return {
      analysis: createDefaultAnalysis(),
      isLLMGenerated: false,
      failureReason: "LLM 未配置，使用默认分析（NEEDS_EVIDENCE）",
      promptVersion,
    };
  }

  // 2. 调用 LLM
  let llmResult;
  try {
    llmResult = await callLLMForAnalysis(context, signal);
  } catch (e: any) {
    return {
      analysis: createDefaultAnalysis(),
      isLLMGenerated: false,
      failureReason: `LLM 调用失败：${e?.message || String(e)}`,
      promptVersion,
    };
  }

  // 3. 解析 LLM 输出
  const analysis = parseAnalysisFromLLMOutput(llmResult.text);
  if (!analysis) {
    return {
      analysis: createDefaultAnalysis(),
      isLLMGenerated: false,
      failureReason: "LLM 输出无法解析为有效 JSON",
      promptVersion,
    };
  }

  // 4. 校验输出
  const citationWhitelist = new Set(context.citationWhitelist.map((c) => c.ref));
  const costScenarioRefs = new Set(context.costScenarios.map((cs) => cs.artifactId));

  const validation = validateProfessionalAnalysis(analysis, citationWhitelist, costScenarioRefs);
  if (!validation.valid) {
    return {
      analysis: createDefaultAnalysis(),
      isLLMGenerated: false,
      failureReason: `输出校验失败：${validation.errors.join("; ")}`,
      promptVersion,
    };
  }

  // 5. 返回有效分析
  return {
    analysis,
    isLLMGenerated: true,
    promptVersion,
  };
}
