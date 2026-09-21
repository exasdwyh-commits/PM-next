/**
 * 专业分析输出结构定义（TASK-015；计划 §1.9 / 契约「结构化成果与门禁契约」B 节）
 *
 * 定义并校验 `ProfessionalAnalysisV1`：
 * - 结论分类：PROCEED_TO_VALIDATE / NEEDS_EVIDENCE / PAUSE / REJECT
 * - 主张分级：FACT / INFERENCE / ASSUMPTION
 * - 所有引用必须来自本次授权上下文
 * - 不让模型凭空填写责任人 ID 或已批准金额
 */

import { ARTIFACT_SCHEMA_VERSION } from "../work/artifact-schema";

// ── 常量 ──

/** 专业分析 schema 版本（与 ARTIFACT_SCHEMA_VERSION 一致） */
export const PROFESSIONAL_ANALYSIS_VERSION = ARTIFACT_SCHEMA_VERSION;

// ── 类型定义 ──

/** 结论分类 */
export type AnalysisConclusion =
  | "PROCEED_TO_VALIDATE"  // 可进入验证阶段
  | "NEEDS_EVIDENCE"       // 需要补充证据
  | "PAUSE"                // 暂停（风险过高或信息不足）
  | "REJECT";              // 拒绝（不可行）

/** 主张分级 */
export type ClaimLevel = "FACT" | "INFERENCE" | "ASSUMPTION";

/** 主张条目 */
export interface AnalysisClaim {
  /** 主张内容 */
  content: string;
  /** 分级：FACT（已验证事实）/ INFERENCE（合理推断）/ ASSUMPTION（假设） */
  level: ClaimLevel;
  /** 来源引用（必须来自授权上下文的 citationWhitelist） */
  sourceRefs: string[];
}

/** 风险条目 */
export interface AnalysisRisk {
  /** 风险描述 */
  description: string;
  /** 影响程度：HIGH / MEDIUM / LOW */
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** 缓解措施（可选） */
  mitigation?: string;
}

/** 推荐动作条目 */
export interface AnalysisRecommendedAction {
  /** 动作描述 */
  action: string;
  /** 优先级：HIGH / MEDIUM / LOW */
  priority: "HIGH" | "MEDIUM" | "LOW";
  /** 负责方（可选；不允许凭空填写具体人名/ID） */
  owner?: string;
}

/** 专业分析 V1 结构 */
export interface ProfessionalAnalysisV1 {
  /** schema 版本（置顶，契约 §4.3 规则 1） */
  schemaVersion: string;
  /** 结论 */
  conclusion: AnalysisConclusion;
  /** 总结（200-500 字） */
  summary: string;
  /** 公司适配度评估 */
  companyFit: string[];
  /** 主张列表（含分级和来源） */
  claims: AnalysisClaim[];
  /** 替代方案 */
  alternatives: string[];
  /** 经济情景引用（来自授权上下文的 costScenarios） */
  economicScenarioRef: string | null;
  /** 风险列表 */
  risks: AnalysisRisk[];
  /** 未知项 */
  unknowns: string[];
  /** 推荐动作 */
  recommendedActions: AnalysisRecommendedAction[];
  /** 局限性说明 */
  limitations: string[];
}

const CONCLUSIONS: AnalysisConclusion[] = [
  "PROCEED_TO_VALIDATE",
  "NEEDS_EVIDENCE",
  "PAUSE",
  "REJECT",
];
const CLAIM_LEVELS: ClaimLevel[] = ["FACT", "INFERENCE", "ASSUMPTION"];
const RISK_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
const ACTION_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * ProfessionalAnalysisV1 的严格运行时结构校验。
 *
 * 这里故意不做“容错修复”：
 * - 非法 claim.level 不能自动降级为 ASSUMPTION
 * - 非法 risk.severity 不能自动改成 MEDIUM
 * - 缺失数组不能自动补 []
 *
 * LLM 输出若不符合契约，应被拒收并走默认/重试路径，而不是伪装成合法结构。
 */
export function isProfessionalAnalysisV1(value: unknown): value is ProfessionalAnalysisV1 {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "string") return false;
  if (!CONCLUSIONS.includes(value.conclusion as AnalysisConclusion)) return false;
  if (typeof value.summary !== "string") return false;
  if (!isStringArray(value.companyFit)) return false;
  if (!isStringArray(value.alternatives)) return false;
  if (!isStringArray(value.unknowns)) return false;
  if (!isStringArray(value.limitations)) return false;
  if (!(value.economicScenarioRef === null || typeof value.economicScenarioRef === "string")) {
    return false;
  }

  if (
    !Array.isArray(value.claims) ||
    !value.claims.every((claim) => {
      if (!isRecord(claim)) return false;
      return (
        typeof claim.content === "string" &&
        CLAIM_LEVELS.includes(claim.level as ClaimLevel) &&
        isStringArray(claim.sourceRefs)
      );
    })
  ) {
    return false;
  }

  if (
    !Array.isArray(value.risks) ||
    !value.risks.every((risk) => {
      if (!isRecord(risk)) return false;
      return (
        typeof risk.description === "string" &&
        RISK_LEVELS.includes(risk.severity as (typeof RISK_LEVELS)[number]) &&
        (risk.mitigation === undefined || typeof risk.mitigation === "string")
      );
    })
  ) {
    return false;
  }

  if (
    !Array.isArray(value.recommendedActions) ||
    !value.recommendedActions.every((action) => {
      if (!isRecord(action)) return false;
      return (
        typeof action.action === "string" &&
        ACTION_PRIORITIES.includes(
          action.priority as (typeof ACTION_PRIORITIES)[number]
        ) &&
        (action.owner === undefined || typeof action.owner === "string")
      );
    })
  ) {
    return false;
  }

  return true;
}

// ── 校验函数 ──

/**
 * 校验单个主张的引用是否合法
 * @param claim 主张条目
 * @param whitelist 引用白名单
 * @returns 校验结果
 */
export function validateClaimRefs(
  claim: AnalysisClaim,
  whitelist: Set<string>
): { valid: boolean; invalidRefs: string[] } {
  const invalidRefs = claim.sourceRefs.filter((ref) => !whitelist.has(ref));
  return {
    valid: invalidRefs.length === 0,
    invalidRefs,
  };
}

/**
 * 校验所有主张的引用是否合法
 * @param claims 主张列表
 * @param whitelist 引用白名单
 * @returns 校验结果
 */
export function validateAllClaims(
  claims: AnalysisClaim[],
  whitelist: Set<string>
): { valid: boolean; errors: Array<{ index: number; invalidRefs: string[] }> } {
  const errors: Array<{ index: number; invalidRefs: string[] }> = [];

  for (let i = 0; i < claims.length; i++) {
    const result = validateClaimRefs(claims[i], whitelist);
    if (!result.valid) {
      errors.push({ index: i, invalidRefs: result.invalidRefs });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 校验金额引用是否合法（金额无对应成本引用则不采纳）
 * @param claim 主张条目
 * @param costScenarioRefs 成本情景引用集合
 * @returns 是否包含金额主张
 */
export function validateAmountRefs(
  claim: AnalysisClaim,
  costScenarioRefs: Set<string>
): { hasAmount: boolean; valid: boolean } {
  // 检查主张内容是否包含金额相关关键词
  const amountPatterns = /\d+\.?\d*\s*(元|¥|￥|\$|USD|CNY)/;
  const hasAmount = amountPatterns.test(claim.content);

  if (!hasAmount) {
    return { hasAmount: false, valid: true };
  }

  // 如果包含金额，必须有对应的成本引用
  const hasCostRef = claim.sourceRefs.some((ref) => costScenarioRefs.has(ref));
  return { hasAmount: true, valid: hasCostRef };
}

/**
 * 校验推荐动作是否包含未授权内容
 * @param action 推荐动作
 * @returns 校验结果
 */
export function validateRecommendedAction(
  action: AnalysisRecommendedAction
): { valid: boolean; reason?: string } {
  // 检查是否包含具体人名/ID（不允许凭空填写）
  const personIdPattern = /@[a-zA-Z0-9_-]+|user-[a-z0-9]+|person-[a-z0-9]+/i;
  if (personIdPattern.test(action.action) || personIdPattern.test(action.owner ?? "")) {
    return {
      valid: false,
      reason: "推荐动作中包含具体人员标识，不允许凭空填写",
    };
  }

  // 检查是否包含已批准金额
  const approvedAmountPattern = /已批准\s*\d+|批准金额\s*\d+|approved\s*\d+/i;
  if (approvedAmountPattern.test(action.action)) {
    return {
      valid: false,
      reason: "推荐动作中包含已批准金额，不允许凭空填写",
    };
  }

  return { valid: true };
}

/**
 * 校验完整的专业分析输出
 * @param analysis 专业分析 V1 结构
 * @param citationWhitelist 引用白名单
 * @param costScenarioRefs 成本情景引用集合
 * @returns 校验结果
 */
export function validateProfessionalAnalysis(
  analysis: ProfessionalAnalysisV1,
  citationWhitelist: Set<string>,
  costScenarioRefs: Set<string>
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 1. 校验 schema 版本
  if (analysis.schemaVersion !== PROFESSIONAL_ANALYSIS_VERSION) {
    errors.push(`schema 版本不匹配：期望 ${PROFESSIONAL_ANALYSIS_VERSION}，实际 ${analysis.schemaVersion}`);
  }

  // 2. 校验结论
  const validConclusions: AnalysisConclusion[] = [
    "PROCEED_TO_VALIDATE",
    "NEEDS_EVIDENCE",
    "PAUSE",
    "REJECT",
  ];
  if (!validConclusions.includes(analysis.conclusion)) {
    errors.push(`结论值无效：${analysis.conclusion}`);
  }

  // 3. 校验总结长度
  if (analysis.summary.length < 200) {
    errors.push(`总结过短：${analysis.summary.length} 字 < 200 字`);
  }
  if (analysis.summary.length > 500) {
    errors.push(`总结过长：${analysis.summary.length} 字 > 500 字`);
  }

  // 4. 校验主张引用
  const claimsValidation = validateAllClaims(analysis.claims, citationWhitelist);
  if (!claimsValidation.valid) {
    for (const err of claimsValidation.errors) {
      errors.push(
        `主张 ${err.index} 包含无效引用：${err.invalidRefs.join(", ")}`
      );
    }
  }

  // 5. 校验金额引用
  for (let i = 0; i < analysis.claims.length; i++) {
    const amountValidation = validateAmountRefs(analysis.claims[i], costScenarioRefs);
    if (amountValidation.hasAmount && !amountValidation.valid) {
      errors.push(
        `主张 ${i} 包含金额但无对应成本引用`
      );
    }
  }

  // 6. 校验推荐动作
  for (let i = 0; i < analysis.recommendedActions.length; i++) {
    const actionValidation = validateRecommendedAction(analysis.recommendedActions[i]);
    if (!actionValidation.valid) {
      errors.push(
        `推荐动作 ${i} 无效：${actionValidation.reason}`
      );
    }
  }

  // 7. 校验经济情景引用
  if (
    analysis.economicScenarioRef !== null &&
    !costScenarioRefs.has(analysis.economicScenarioRef)
  ) {
    errors.push(`经济情景引用无效：${analysis.economicScenarioRef}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 创建空的/默认的专业分析结构（用于初始化或回退）
 */
export function createDefaultAnalysis(): ProfessionalAnalysisV1 {
  return {
    schemaVersion: PROFESSIONAL_ANALYSIS_VERSION,
    conclusion: "NEEDS_EVIDENCE",
    summary: "数据不足，无法给出专业分析结论。需要补充更多证据和信息。当前可用的数据无法支持做出可靠的专业判断，建议在获取更多关键数据后重新进行分析。这是一个默认的分析结果，表明系统在没有足够输入的情况下无法提供有价值的洞察。为了获得准确的专业分析，请确保提供完整的产品信息、市场数据、成本结构、供应链信息和相关证据。只有在获得充分的数据支持后，系统才能生成有意义的专业分析报告，帮助决策者做出明智的选择。请按照系统提示词要求的 JSON 格式输出分析结果。",
    companyFit: [],
    claims: [],
    alternatives: [],
    economicScenarioRef: null,
    risks: [],
    unknowns: ["数据不足，无法进行分析"],
    recommendedActions: [
      {
        action: "补充必要的证据和信息后再进行分析",
        priority: "HIGH",
      },
    ],
    limitations: ["输入数据不足，分析受限"],
  };
}
