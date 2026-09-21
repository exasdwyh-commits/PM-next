/**
 * 科学证据层（Scientific Evidence Intelligence）
 *
 * 与商业证据（evidence-claims.ts）并列，专门处理原料/剂量/机制/人体证据的分级与验证。
 * 纯函数，不接外部爬虫，不抓取页面，不凭空构造数字。
 *
 * 核心原则：
 * 1. 证据等级诚实标注（A/B/C/D），不确定就降级，不升级；
 * 2. 冲突并列，不静默覆盖；
 * 3. 营销边界必填，供 Advisor 直接引用；
 * 4. 与商业证据分离：SCIENTIFIC_FACT 不可与 COMMERCIAL_FACT 混用。
 * 5. 区分原料/成品、研究对象、条件、来源、限制（TASK-018）。
 */

export type EvidenceLevel = "A" | "B" | "C" | "D";

/** 证据来源类型（TASK-018 新增） */
export type EvidenceSourceType = 
  | "RAW_MATERIAL_STUDY"      // 原料研究（体外/动物/人体）
  | "FINISHED_PRODUCT_STUDY"  // 成品研究（已上市产品的人体研究）
  | "MECHANISM_ONLY"          // 仅机制研究（无直接人体数据）
  | "EXPERT_OPINION"          // 专家意见（非系统性综述）
  | "TRADITIONAL_USE"         // 传统使用经验（非现代研究）
  | "REGULATORY_REFERENCE";   // 监管/法规参考

/** 证据限制类型（TASK-018 新增） */
export type EvidenceLimitationType = 
  | "SAMPLE_SIZE_SMALL"       // 样本量不足
  | "NO_CONTROL_GROUP"        // 无对照组
  | "OPEN_LABEL_ONLY"         // 仅开放标签
  | "SHORT_DURATION"          // 研究周期短
  | "ANIMAL_MODEL_ONLY"       // 仅动物模型
  | "IN_VITRO_ONLY"           // 仅体外实验
  | "CONFLICTING_DATA"        // 数据冲突
  | "VENDOR_FUNDED"           // 供应商资助
  | "POPULATION_MISMATCH";    // 研究人群与目标人群不匹配

export interface ScientificEvidenceInput {
  ingredient: string;
  /** 别名/化学名/英文名：用于产品规格字段的关键词匹配（如 AKG 的「α-酮戊二酸」） */
  aliases?: string[] | null;
  claim: string;
  evidenceLevel: EvidenceLevel;
  humanRCTCount: number;
  sampleSizeTotal: number;
  doseRange?: string | null;
  mechanism?: string | null;
  applicablePopulation?: string | null;
  marketingSay?: string | null;
  marketingNever?: string | null;
  confidence: number;
  lastReviewed: string;
  status: "DRAFT" | "CONFIRMED" | "SUPERSEDED";
  
  /** TASK-018 新增字段 */
  /** 证据来源类型：区分原料研究 vs 成品研究 */
  sourceType?: EvidenceSourceType | null;
  /** 研究条件：研究的具体条件和环境 */
  studyConditions?: string | null;
  /** 研究限制列表 */
  limitations?: EvidenceLimitationType[] | null;
  /** 数据来源：具体研究/论文/数据库 */
  dataSources?: string | null;
  /** 研究对象：体外/动物/人体/混合 */
  researchSubjects?: "IN_VITRO" | "ANIMAL" | "HUMAN" | "MIXED" | null;
  /** 成品研究：如果 sourceType 是 FINISHED_PRODUCT_STUDY，记录成品名称和批次 */
  finishedProductRef?: string | null;
}

export interface ScientificEvidenceCard extends ScientificEvidenceInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScientificReviewTriggerInput {
  claim: string;
  ingredientCostPerUnit?: number;
  hasHealthClaim: boolean;
  evidenceConfidence?: number;
  advisorVerdict?: string | null;
  productPrice?: number;
}

export interface ScientificReviewTriggerResult {
  shouldTrigger: boolean;
  reasons: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export function computeEvidenceLevel(input: {
  humanRCTCount: number;
  sampleSizeTotal: number;
  hasMultiCenter?: boolean;
  hasIndependentReplication?: boolean;
  hasOpenLabelOnly?: boolean;
}): EvidenceLevel {
  const { humanRCTCount, sampleSizeTotal, hasMultiCenter, hasIndependentReplication, hasOpenLabelOnly } = input;
  if (humanRCTCount >= 3 && sampleSizeTotal >= 300 && hasMultiCenter && hasIndependentReplication) {
    return "A";
  }
  if (humanRCTCount >= 1 && !hasOpenLabelOnly) {
    return "B";
  }
  if (humanRCTCount >= 1 && hasOpenLabelOnly) {
    return "C";
  }
  return "D";
}

export function maxConfidenceByLevel(level: EvidenceLevel): number {
  switch (level) {
    case "A": return 95;
    case "B": return 80;
    case "C": return 55;
    case "D": return 30;
  }
}

export function normalizeScientificEvidence(
  input: ScientificEvidenceInput,
  index: number
): ScientificEvidenceInput | null {
  const ingredient = input.ingredient?.trim();
  const claim = input.claim?.trim();
  const evidenceLevel = input.evidenceLevel;
  const confidence = input.confidence;

  if (!ingredient) {
    throw new Error(`科学证据#${index} 缺少原料名称 ingredient`);
  }
  if (!claim) {
    throw new Error(`科学证据#${index}[${ingredient}] 缺少宣称 claim`);
  }
  if (!["A", "B", "C", "D"].includes(evidenceLevel)) {
    throw new Error(`科学证据#${index}[${ingredient}] 证据等级必须为 A/B/C/D，当前为 ${evidenceLevel}`);
  }

  const maxConf = maxConfidenceByLevel(evidenceLevel);
  if (!Number.isInteger(input.humanRCTCount) || input.humanRCTCount < 0) {
    throw new Error(`科学证据#${index}[${ingredient}] humanRCTCount 必须为非负整数`);
  }
  if (!Number.isInteger(input.sampleSizeTotal) || input.sampleSizeTotal < 0) {
    throw new Error(`科学证据#${index}[${ingredient}] sampleSizeTotal 必须为非负整数`);
  }
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    throw new Error(`科学证据#${index}[${ingredient}] 置信度必须为 0-100 的整数`);
  }
  if (confidence > maxConf) {
    throw new Error(
      `科学证据#${index}[${ingredient}] 置信度 ${confidence}% 超过证据等级 ${evidenceLevel} 的上限 ${maxConf}%，请降级或补充证据`
    );
  }

  if (!input.marketingSay?.trim()) {
    throw new Error(`科学证据#${index}[${ingredient}] 必须填写「可以说」营销边界 marketing_say`);
  }
  if (!input.marketingNever?.trim()) {
    throw new Error(`科学证据#${index}[${ingredient}] 必须填写「禁止说」营销边界 marketing_never`);
  }
  if (!['DRAFT', 'CONFIRMED', 'SUPERSEDED'].includes(input.status)) {
    throw new Error(`科学证据#${index}[${ingredient}] status 必须为 DRAFT/CONFIRMED/SUPERSEDED`);
  }

  return {
    ...input,
    ingredient,
    claim,
    doseRange: input.doseRange?.trim() || null,
    mechanism: input.mechanism?.trim() || null,
    applicablePopulation: input.applicablePopulation?.trim() || null,
    marketingSay: input.marketingSay.trim(),
    marketingNever: input.marketingNever.trim(),
    lastReviewed: input.lastReviewed?.trim() || new Date().toISOString().slice(0, 10),
    status: input.status || "DRAFT",
    // TASK-018 新增字段
    sourceType: input.sourceType || null,
    studyConditions: input.studyConditions?.trim() || null,
    limitations: input.limitations || null,
    dataSources: input.dataSources?.trim() || null,
    researchSubjects: input.researchSubjects || null,
    finishedProductRef: input.finishedProductRef?.trim() || null,
  };
}

/**
 * TASK-018 新增：获取证据来源类型描述
 */
export function getSourceTypeLabel(sourceType: EvidenceSourceType | null): string {
  switch (sourceType) {
    case "RAW_MATERIAL_STUDY": return "原料研究";
    case "FINISHED_PRODUCT_STUDY": return "成品研究";
    case "MECHANISM_ONLY": return "仅机制研究";
    case "EXPERT_OPINION": return "专家意见";
    case "TRADITIONAL_USE": return "传统使用经验";
    case "REGULATORY_REFERENCE": return "监管/法规参考";
    default: return "未指定来源";
  }
}

/**
 * TASK-018 新增：获取研究对象描述
 */
export function getResearchSubjectsLabel(researchSubjects: ScientificEvidenceInput["researchSubjects"]): string {
  switch (researchSubjects) {
    case "IN_VITRO": return "体外实验";
    case "ANIMAL": return "动物研究";
    case "HUMAN": return "人体研究";
    case "MIXED": return "混合研究（体外/动物/人体）";
    default: return "未指定研究对象";
  }
}

/**
 * TASK-018 新增：获取证据限制描述
 */
export function getLimitationLabel(limitation: EvidenceLimitationType): string {
  switch (limitation) {
    case "SAMPLE_SIZE_SMALL": return "样本量不足";
    case "NO_CONTROL_GROUP": return "无对照组";
    case "OPEN_LABEL_ONLY": return "仅开放标签";
    case "SHORT_DURATION": return "研究周期短";
    case "ANIMAL_MODEL_ONLY": return "仅动物模型";
    case "IN_VITRO_ONLY": return "仅体外实验";
    case "CONFLICTING_DATA": return "数据冲突";
    case "VENDOR_FUNDED": return "供应商资助";
    case "POPULATION_MISMATCH": return "研究人群与目标人群不匹配";
    default: return "未知限制";
  }
}

/**
 * TASK-018 新增：验证证据来源与研究对象的一致性
 * - 如果 sourceType 是 RAW_MATERIAL_STUDY，researchSubjects 不能是 HUMAN（除非有成品研究支持）
 * - 如果 sourceType 是 FINISHED_PRODUCT_STUDY，必须有 finishedProductRef
 */
export function validateEvidenceSourceConsistency(
  input: ScientificEvidenceInput
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (input.sourceType === "FINISHED_PRODUCT_STUDY" && !input.finishedProductRef?.trim()) {
    errors.push(`原料 ${input.ingredient} 标记为成品研究，但缺少成品引用 finishedProductRef`);
  }
  
  if (input.sourceType === "MECHANISM_ONLY" && input.researchSubjects === "HUMAN") {
    errors.push(`原料 ${input.ingredient} 标记为仅机制研究，但研究对象为人体，存在矛盾`);
  }
  
  if (input.sourceType === "TRADITIONAL_USE" && input.humanRCTCount > 0) {
    errors.push(`原料 ${input.ingredient} 标记为传统使用经验，但有人体 RCT 数据，来源类型可能不准确`);
  }
  
  return { valid: errors.length === 0, errors };
}

const STRONG_CLAIM_PATTERN = /改善|降低|逆龄|预防|治疗|治愈|根治|延寿|年轻|抗衰老|抗癌|降糖|降压|减脂/;

const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
type RiskLevel = keyof typeof RISK_ORDER;

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function shouldTriggerScientificReview(
  input: ScientificReviewTriggerInput
): ScientificReviewTriggerResult {
  const reasons: string[] = [];
  let riskLevel: RiskLevel = "LOW";

  if (STRONG_CLAIM_PATTERN.test(input.claim)) {
    reasons.push(`宣称包含强功效词（${input.claim.match(STRONG_CLAIM_PATTERN)?.[0]}）`);
    riskLevel = maxRisk(riskLevel, "HIGH");
  }
  if ((input.ingredientCostPerUnit ?? 0) > 500) {
    reasons.push(`单原料成本 ${input.ingredientCostPerUnit} 元/单位，超过 500 元阈值`);
    riskLevel = maxRisk(riskLevel, "HIGH");
  }
  if (input.hasHealthClaim) {
    reasons.push("涉及健康功效宣称，需验证因果关系");
    riskLevel = maxRisk(riskLevel, "MEDIUM");
  }
  if (input.advisorVerdict === "CONFLICT") {
    reasons.push("Advisor 与 Product Agent 意见冲突");
    riskLevel = maxRisk(riskLevel, "CRITICAL");
  }
  const conf = input.evidenceConfidence ?? 100;
  if (conf < 70) {
    reasons.push(`证据置信度 ${conf}% < 70%`);
    riskLevel = maxRisk(riskLevel, "MEDIUM");
  }
  if ((input.productPrice ?? 0) > 1000 && STRONG_CLAIM_PATTERN.test(input.claim)) {
    reasons.push(`高定价（${input.productPrice} 元）叠加强宣称，合规风险极高`);
    riskLevel = maxRisk(riskLevel, "CRITICAL");
  }

  return { shouldTrigger: reasons.length > 0, reasons, riskLevel };
}

export interface ScientificConflict {
  ingredient: string;
  field: "dose" | "mechanism" | "evidenceLevel" | "claim";
  values: string[];
  description: string;
}

export function detectScientificConflicts(
  cards: ScientificEvidenceInput[]
): ScientificConflict[] {
  const conflicts: ScientificConflict[] = [];
  const byIngredient = new Map<string, ScientificEvidenceInput[]>();

  for (const card of cards) {
    const key = card.ingredient.toLowerCase().trim();
    if (!byIngredient.has(key)) byIngredient.set(key, []);
    byIngredient.get(key)!.push(card);
  }

  for (const [ingredient, list] of byIngredient) {
    if (list.length < 2) continue;

    const doses = new Set(list.map((c) => c.doseRange?.trim()).filter((v): v is string => Boolean(v)));
    if (doses.size > 1) {
      conflicts.push({
        ingredient,
        field: "dose",
        values: Array.from(doses),
        description: `原料 ${ingredient} 存在多个剂量记录：${Array.from(doses).join(" vs ")}`,
      });
    }

    const levels = new Set(list.map((c) => c.evidenceLevel));
    if (levels.size > 1) {
      conflicts.push({
        ingredient,
        field: "evidenceLevel",
        values: Array.from(levels),
        description: `原料 ${ingredient} 存在多个证据等级：${Array.from(levels).join(" vs ")}，需人工确认最新评估`,
      });
    }

    const claims = new Set(list.map((c) => c.claim));
    if (claims.size > 1) {
      conflicts.push({
        ingredient,
        field: "claim",
        values: Array.from(claims),
        description: `原料 ${ingredient} 存在多个宣称方向：${Array.from(claims).join(" vs ")}，需统一`,
      });
    }
  }

  return conflicts;
}

export interface ScientificGap {
  ingredient: string;
  field: "humanRCT" | "dose" | "mechanism" | "marketingBoundary";
  description: string;
}

export function computeScientificGaps(card: ScientificEvidenceInput): ScientificGap[] {
  const gaps: ScientificGap[] = [];

  if (card.humanRCTCount === 0) {
    gaps.push({
      ingredient: card.ingredient,
      field: "humanRCT",
      description: `缺少人体随机对照试验，当前证据等级 ${card.evidenceLevel} 主要基于动物/体外/开放标签`,
    });
  }

  if (!card.doseRange?.trim()) {
    gaps.push({
      ingredient: card.ingredient,
      field: "dose",
      description: "缺少明确剂量范围，无法评估成本-效果比",
    });
  }

  if (!card.mechanism?.trim()) {
    gaps.push({
      ingredient: card.ingredient,
      field: "mechanism",
      description: "缺少机制说明，无法判断宣称的生物学合理性",
    });
  }

  if (!card.marketingSay?.trim() || !card.marketingNever?.trim()) {
    gaps.push({
      ingredient: card.ingredient,
      field: "marketingBoundary",
      description: "营销边界未完整填写，Advisor 无法执行合规审查",
    });
  }

  return gaps;
}

/**
 * TASK-018 新增：证据来源摘要
 */
export interface ScientificEvidenceSummary {
  totalCards: number;
  bySourceType: Record<EvidenceSourceType, number>;
  byResearchSubjects: Record<string, number>;
  rawMaterialStudies: number;
  finishedProductStudies: number;
  mechanismOnlyStudies: number;
  withLimitations: number;
  limitationsBreakdown: Record<EvidenceLimitationType, number>;
}

/**
 * TASK-018 新增：生成证据来源摘要
 */
export function summarizeEvidenceSource(
  cards: ScientificEvidenceInput[]
): ScientificEvidenceSummary {
  const summary: ScientificEvidenceSummary = {
    totalCards: cards.length,
    bySourceType: {
      RAW_MATERIAL_STUDY: 0,
      FINISHED_PRODUCT_STUDY: 0,
      MECHANISM_ONLY: 0,
      EXPERT_OPINION: 0,
      TRADITIONAL_USE: 0,
      REGULATORY_REFERENCE: 0,
    },
    byResearchSubjects: {
      IN_VITRO: 0,
      ANIMAL: 0,
      HUMAN: 0,
      MIXED: 0,
      UNSPECIFIED: 0,
    },
    rawMaterialStudies: 0,
    finishedProductStudies: 0,
    mechanismOnlyStudies: 0,
    withLimitations: 0,
    limitationsBreakdown: {
      SAMPLE_SIZE_SMALL: 0,
      NO_CONTROL_GROUP: 0,
      OPEN_LABEL_ONLY: 0,
      SHORT_DURATION: 0,
      ANIMAL_MODEL_ONLY: 0,
      IN_VITRO_ONLY: 0,
      CONFLICTING_DATA: 0,
      VENDOR_FUNDED: 0,
      POPULATION_MISMATCH: 0,
    },
  };

  for (const card of cards) {
    // 按来源类型统计
    const sourceType = card.sourceType || "MECHANISM_ONLY";
    summary.bySourceType[sourceType]++;

    // 按研究对象统计
    const subjects = card.researchSubjects || "UNSPECIFIED";
    summary.byResearchSubjects[subjects] = (summary.byResearchSubjects[subjects] || 0) + 1;

    // 按研究类型统计
    if (sourceType === "RAW_MATERIAL_STUDY") {
      summary.rawMaterialStudies++;
    } else if (sourceType === "FINISHED_PRODUCT_STUDY") {
      summary.finishedProductStudies++;
    } else if (sourceType === "MECHANISM_ONLY") {
      summary.mechanismOnlyStudies++;
    }

    // 统计限制
    if (card.limitations && card.limitations.length > 0) {
      summary.withLimitations++;
      for (const lim of card.limitations) {
        summary.limitationsBreakdown[lim]++;
      }
    }
  }

  return summary;
}
