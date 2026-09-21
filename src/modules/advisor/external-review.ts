/**
 * 外部科学复核（External Scientific Review）
 *
 * 定位：Hermes 内部完成初步分析后，遇到高价值/高争议科学问题时，
 * 生成标准化「审查包」供外部科研工作台（如 OpenAI Prism）独立复核。
 *
 * 当前为半自动流程：
 *   1. Hermes 生成 Review Packet（Markdown）
 *   2. 人工复制到 Prism / 其他科研工具
 *   3. 复核结果贴回 Hermes，解析为结构化 Review
 *   4. Advisor 将外部意见作为「独立专家意见」纳入挑战报告
 *
 * 未来若官方开放 API，只需替换导出/导入层，核心结构不变。
 *
 * TASK-018 扩展：外部评审只导入经验证结果，不因名为 review 就自动确认。
 */

import type { ScientificEvidenceInput } from "../research/scientific-evidence";

export interface ReviewPacket {
  question: string;
  proposedClaim: string;
  targetPopulation?: string;
  dose?: string;
  duration?: string;
  ingredients: ScientificEvidenceInput[];
  reviewTasks: string[];
  generatedAt: string;
}

/** TASK-018 新增：外部复核结果验证状态 */
export type VerifiedStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONFLICTING";

export interface ExternalReviewResult {
  status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_SUPPORTED" | "INSUFFICIENT_EVIDENCE";
  confidence: number;
  supported: string[];
  notSupported: string[];
  conflictingEvidence: string[];
  missingEvidence: string[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  recommendedClaim: string;
  citations: string[];
  reviewedAt: string;
  reviewer: string;
  /** TASK-018 新增：验证状态 */
  verificationStatus: VerifiedStatus;
  /** TASK-018 新增：验证说明 */
  verificationNotes: string;
  /** TASK-018 新增：是否已通过验证（只有 VERIFIED 状态才能用于挑战报告） */
  isVerified: boolean;
}

const DEFAULT_REVIEW_TASKS = [
  "验证核心假设是否被现有证据支持",
  "寻找最强反证与矛盾证据",
  "检查人体研究质量（样本量/对照/盲法/周期）",
  "判断剂量合理性与安全性",
  "识别夸大宣传与营销红线",
  "指出缺失证据与下一步验证方案",
];

/**
 * 生成标准化 Review Packet（Markdown），可直接粘贴到 Prism 或其他科研工具。
 */
export function buildReviewPacket(input: {
  question: string;
  proposedClaim: string;
  targetPopulation?: string;
  dose?: string;
  duration?: string;
  ingredients: ScientificEvidenceInput[];
  customTasks?: string[];
}): string {
  const tasks = input.customTasks || DEFAULT_REVIEW_TASKS;
  const ingredientSections = input.ingredients
    .map(
      (i) => `### ${i.ingredient}
- 宣称：${i.claim}
- 证据等级：${i.evidenceLevel}
- 人体 RCT：${i.humanRCTCount} 项（合计 ${i.sampleSizeTotal} 人）
- 剂量：${i.doseRange || "未定"}
- 机制：${i.mechanism || "未明"}
- 当前置信度：${i.confidence}%
- 营销边界（内部）：可以说「${i.marketingSay}」/ 禁止说「${i.marketingNever}」`
    )
    .join("\n\n");

  return `# 外部科学复核请求

## 复核问题
${input.question}

## 提议宣称
${input.proposedClaim}

## 目标人群
${input.targetPopulation || "未指定"}

## 剂量与周期
${input.dose || "未定"} / ${input.duration || "未定"}

## 现有内部证据
${ingredientSections}

## 复核任务
${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## 输出格式要求
请以以下 JSON 结构返回复核结论：
\`\`\`json
{
  "status": "SUPPORTED | PARTIALLY_SUPPORTED | NOT_SUPPORTED | INSUFFICIENT_EVIDENCE",
  "confidence": 0-100,
  "supported": ["..."],
  "notSupported": ["..."],
  "conflictingEvidence": ["..."],
  "missingEvidence": ["..."],
  "risk": "LOW | MEDIUM | HIGH",
  "recommendedClaim": "...",
  "citations": ["..."]
}
\`\`\`

---
生成时间：${new Date().toISOString()}
`;
}

/**
 * 解析外部复核结果（JSON 字符串或对象）。
 * 校验必填字段，拒绝不完整结果。
 *
 * TASK-018 扩展：增加验证状态逻辑，只有 VERIFIED 状态才能用于挑战报告。
 */
export function parseExternalReviewResult(
  raw: string | Record<string, unknown>,
  reviewer: string = "external"
): ExternalReviewResult {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!obj.status || !["SUPPORTED", "PARTIALLY_SUPPORTED", "NOT_SUPPORTED", "INSUFFICIENT_EVIDENCE"].includes(obj.status as string)) {
    throw new Error("外部复核结果缺少合法的 status 字段");
  }
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 100) {
    throw new Error("外部复核结果 confidence 必须为 0-100 的数字");
  }
  if (!obj.recommendedClaim || typeof obj.recommendedClaim !== "string") {
    throw new Error("外部复核结果缺少 recommendedClaim");
  }

  // TASK-018 新增：验证状态逻辑
  const verificationStatus: VerifiedStatus = obj.verificationStatus || "UNVERIFIED";
  const verificationNotes = obj.verificationNotes || "";
  
  // 只有 VERIFIED 状态才能用于挑战报告
  const isVerified = verificationStatus === "VERIFIED" && 
    obj.confidence >= 70 && 
    (Array.isArray(obj.citations) && obj.citations.length > 0);

  return {
    status: obj.status as ExternalReviewResult["status"],
    confidence: obj.confidence,
    supported: Array.isArray(obj.supported) ? obj.supported : [],
    notSupported: Array.isArray(obj.notSupported) ? obj.notSupported : [],
    conflictingEvidence: Array.isArray(obj.conflictingEvidence) ? obj.conflictingEvidence : [],
    missingEvidence: Array.isArray(obj.missingEvidence) ? obj.missingEvidence : [],
    risk: (obj.risk as ExternalReviewResult["risk"]) || "MEDIUM",
    recommendedClaim: obj.recommendedClaim,
    citations: Array.isArray(obj.citations) ? obj.citations : [],
    reviewedAt: new Date().toISOString(),
    reviewer,
    verificationStatus,
    verificationNotes,
    isVerified,
  };
}
