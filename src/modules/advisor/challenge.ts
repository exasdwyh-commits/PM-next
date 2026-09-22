/**
 * 挑战我的判断（Challenge My Thesis）
 *
 * Advisor 核心增强：对任何产品假设进行证伪式审查。
 * 输出不是「这个项目不错」，而是：
 * - 最可能失败的 3 个原因
 * - 尚未验证的假设
 * - 一票否决数据
 * - 最低成本验证实验
 * - 建议 MVP
 *
 * 当前为确定性模板生成（TEST_STUB 模式），不依赖外部模型；
 * 接入真实模型后，只需替换 generateChallengeReport 中的模板填充逻辑。
 *
 * TASK-018 扩展：区分原料/成品证据来源，增强证据可信度判断。
 */

import {
  ScientificEvidenceInput,
  computeScientificGaps,
  detectScientificConflicts,
  shouldTriggerScientificReview,
  normalizeScientificEvidence,
  summarizeEvidenceSource,
  validateEvidenceSourceConsistency,
  type ScientificGap,
  type ScientificConflict,
  type ScientificEvidenceSummary,
  type EvidenceSourceType,
} from "../research/scientific-evidence";

export interface ChallengeInput {
  productName: string;
  proposedClaim: string;
  targetPrice?: number;
  targetDuration?: string;
  ingredients: ScientificEvidenceInput[];
  advisorVerdict?: string | null;
  commercialGaps?: string[];
  competitorCount?: number;
  /**
   * 证据范围说明：本次审查实际纳入了哪些原料卡、为何是这个范围。
   * 原料相关性无法确定时必须如实说明，不得把无关原料卡当成该产品的证据。
   */
  evidenceScope?: {
    considered: number;
    matched: number;
    ingredientNames: string[];
    note: string;
  } | null;
}

export interface ChallengeEvidenceScope {
  considered: number;
  matched: number;
  ingredientNames: string[];
  note: string;
}

export interface ChallengeReport {
  productName: string;
  proposedClaim: string;
  generatedAt: string;
  reviewTriggers: string[];
  topFailureReasons: string[];
  unvalidatedAssumptions: string[];
  vetoData: string[];
  cheapestExperiments: string[];
  recommendedMVP: string;
  scientificGaps: ScientificGap[];
  scientificConflicts: ScientificConflict[];
  overallRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommendation: "PROCEED" | "MODIFY" | "PAUSE" | "KILL";
  /** 证据范围：纳入的原料卡与范围说明（含「未找到相关原料卡」的如实说明） */
  evidenceScope: ChallengeEvidenceScope;
  /** TASK-018 新增：证据来源摘要 */
  evidenceSummary: ScientificEvidenceSummary;
  /** TASK-018 新增：证据来源一致性校验结果 */
  evidenceConsistency: { valid: boolean; errors: string[] };
}

export function generateChallengeReport(input: ChallengeInput): ChallengeReport {
  const { productName, proposedClaim, ingredients, advisorVerdict, targetPrice } = input;

  const triggers = shouldTriggerScientificReview({
    claim: proposedClaim,
    hasHealthClaim: /改善|降低|逆龄|减龄|生物年龄|甲基化年龄|抗衰|预防|治疗|健康|功效|代谢|衰老|免疫|血糖|血压|肠道|肌肉|减肥/.test(proposedClaim),
    advisorVerdict: advisorVerdict ?? null,
    productPrice: targetPrice,
    evidenceConfidence:
      ingredients.length > 0 ? Math.min(...ingredients.map((i) => i.confidence)) : 0,
  });

  const allGaps: ScientificGap[] = ingredients.flatMap((i) => computeScientificGaps(i));
  const allConflicts: ScientificConflict[] = detectScientificConflicts(ingredients);

  // 证据范围：没纳入任何原料卡时必须如实说明，不能假装审查过科学证据
  const evidenceScope: ChallengeEvidenceScope =
    input.evidenceScope ??
    (ingredients.length > 0
      ? {
          considered: ingredients.length,
          matched: ingredients.length,
          ingredientNames: ingredients.map((i) => i.ingredient),
          note: `本次审查纳入 ${ingredients.length} 张原料证据卡。`,
        }
      : {
          considered: 0,
          matched: 0,
          ingredientNames: [],
          note: "本次审查未匹配到任何原料证据卡，科学证据维度无依据，结论仅基于商业与合规判断。",
        });

  const topFailureReasons: string[] = [];

  // 无原料卡：科学证据维度无依据，必须作为首要失败原因列出
  if (ingredients.length === 0) {
    topFailureReasons.push(
      "未匹配到任何原料证据卡：功效宣称缺少科学依据支撑，无法验证「宣称—证据」是否匹配"
    );
  }

  const weakEvidence = ingredients.filter((i) => i.evidenceLevel === "C" || i.evidenceLevel === "D");
  if (weakEvidence.length > 0) {
    topFailureReasons.push(
      `核心原料证据等级过低：${weakEvidence.map((i) => `${i.ingredient}(${i.evidenceLevel})`).join("、")}，宣称与证据不匹配`
    );
  }
  const lowConfidence = ingredients.filter((i) => i.confidence < 60);
  if (lowConfidence.length > 0) {
    topFailureReasons.push(
      `原料置信度不足：${lowConfidence.map((i) => `${i.ingredient}(${i.confidence}%)`).join("、")}，消费者可能无法感知效果`
    );
  }
  const overClaim = ingredients.filter((i) =>
    (i.marketingNever ?? "")
      .split(/[\\/、，,；;]+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .some((term) => proposedClaim.includes(term))
  );
  if (overClaim.length > 0) {
    topFailureReasons.push(
      `宣称「${proposedClaim}」触碰营销红线：${overClaim.map((i) => `${i.ingredient} 禁止说「${i.marketingNever}」`).join("；")}`
    );
  }
  if (allConflicts.length > 0) {
    topFailureReasons.push(
      `存在 ${allConflicts.length} 项未解决的科学冲突：${allConflicts.slice(0, 2).map((c) => c.description).join("；")}`
    );
  }
  if (allGaps.length > 0) {
    topFailureReasons.push(
      `存在 ${allGaps.length} 项证据缺口：${allGaps.slice(0, 2).map((g) => g.description).join("；")}`
    );
  }
  if (topFailureReasons.length < 3 && (targetPrice ?? 0) > 1500) {
    topFailureReasons.push(`定价 ${targetPrice} 元属于高客单价，消费者对「体感」预期极高，抗衰老品类常见「无体感退货」`);
  }
  if (topFailureReasons.length < 3 && ingredients.length > 2) {
    topFailureReasons.push(`复配 ${ingredients.length} 种原料，但联用人体证据未知，可能只是「堆砌明星原料」`);
  }

  const unvalidatedAssumptions: string[] = [];
  for (const gap of allGaps) {
    if (gap.field === "humanRCT") unvalidatedAssumptions.push(`${gap.ingredient}：人体效果尚未被 RCT 验证`);
    if (gap.field === "dose") unvalidatedAssumptions.push(`${gap.ingredient}：有效剂量范围未确定`);
  }
  if ((input.competitorCount ?? 0) === 0) {
    unvalidatedAssumptions.push("市场竞品数量为 0，可能是蓝海，也可能是「需求不存在」");
  }

  const vetoData: string[] = [];
  const hasMethylationClaim = /甲基化|生物年龄|逆龄|减龄|年轻/.test(proposedClaim);
  if (hasMethylationClaim) {
    vetoData.push("若后续同批样本检测显示甲基化年龄无变化或上升，则停止扩大该宣称（需先取得真实检测结果）");
  }
  const lowLevelIngredients = ingredients.filter((i) => i.evidenceLevel === "D");
  if (lowLevelIngredients.length > 0) {
    vetoData.push(`任何 ${lowLevelIngredients.map((i) => i.ingredient).join("、")} 的负面安全性报告`);
  }
  if (triggers.riskLevel === "CRITICAL") {
    vetoData.push("监管/平台下架通知或职业打假人举报");
  }

  const cheapestExperiments: string[] = [];
  const rctGap = allGaps.find((g) => g.field === "humanRCT");
  if (rctGap) {
    cheapestExperiments.push(`小样本开放标签试点（先验证 ${rctGap.ingredient} 的基础安全性与初步体感；样本量、周期与成本需按方案及供应商报价确认）`);
  }
  if (hasMethylationClaim) {
    cheapestExperiments.push("甲基化时钟平台对比测试（同一批样本送 2 个平台）：先验证检测一致性，再决定是否扩大样本（成本需按平台报价确认）");
  }
  if (allConflicts.length > 0) {
    cheapestExperiments.push(`文献复核与领域专家访谈：解决 ${allConflicts[0].ingredient} 的证据冲突（专家数量与成本需按复核范围确认）`);
  }
  if (cheapestExperiments.length === 0) {
    cheapestExperiments.push("目标用户深度访谈：先验证「无体感」是否为真实痛点，样本量与成本需按访谈方案确认");
  }

  let recommendedMVP = "";
  // 复制后排序，避免原地修改调用方传入的数组
  const sortedIngredients = [...ingredients].sort((a, b) => a.confidence - b.confidence);
  const weakestIngredient = sortedIngredients[0];
  if (weakestIngredient && weakestIngredient.confidence < 50) {
    recommendedMVP = `先做单原料小规格测试装（${weakestIngredient.ingredient}，30 天量），验证复购率与 NPS，而非直接推 ${input.targetDuration || "长期"} 套餐`;
  } else if (hasMethylationClaim) {
    recommendedMVP = "先跑小样本开放标签 + 甲基化检测，确认「可检测到的变化」再放大，而非直接承诺「年轻 X 岁」";
  } else {
    recommendedMVP = `先推单原料标准装，验证 ${weakestIngredient?.ingredient || "核心成分"} 的复购与口碑，再考虑复配`;
  }

  // 没有任何相关证据时，不能把“尚未验证”当成可继续推进；至少进入中风险审查。
  const overallRisk = ingredients.length === 0 && triggers.riskLevel === "LOW" ? "MEDIUM" : triggers.riskLevel;
  let recommendation: "PROCEED" | "MODIFY" | "PAUSE" | "KILL" = "PROCEED";
  if (ingredients.length === 0) recommendation = "PAUSE";
  else if (overallRisk === "CRITICAL") recommendation = "KILL";
  else if (overallRisk === "HIGH") recommendation = "PAUSE";
  else if (topFailureReasons.length >= 3 || allGaps.length >= 3) recommendation = "MODIFY";
  else if (weakEvidence.length > 0 || lowConfidence.length > 0) recommendation = "MODIFY";

  // TASK-018 新增：证据来源摘要和一致性校验
  const evidenceSummary = summarizeEvidenceSource(ingredients);
  const evidenceConsistency = ingredients.reduce(
    (acc, card) => {
      const result = validateEvidenceSourceConsistency(card);
      return {
        valid: acc.valid && result.valid,
        errors: [...acc.errors, ...result.errors],
      };
    },
    { valid: true, errors: [] as string[] }
  );

  // TASK-018 新增：如果证据来源不一致，增加风险提示
  if (!evidenceConsistency.valid) {
    topFailureReasons.push(
      `证据来源一致性问题：${evidenceConsistency.errors.slice(0, 2).join("；")}`
    );
  }

  // TASK-018 新增：如果只有机制研究，缺乏人体数据，增加风险提示
  if (evidenceSummary.mechanismOnlyStudies > 0 && evidenceSummary.rawMaterialStudies === 0 && evidenceSummary.finishedProductStudies === 0) {
    topFailureReasons.push(
      `仅 ${evidenceSummary.mechanismOnlyStudies} 项机制研究，缺乏人体数据，宣称支撑不足`
    );
  }

  return {
    productName,
    proposedClaim,
    generatedAt: new Date().toISOString(),
    reviewTriggers: triggers.reasons,
    topFailureReasons: topFailureReasons.slice(0, 3),
    unvalidatedAssumptions,
    vetoData,
    cheapestExperiments,
    recommendedMVP,
    scientificGaps: allGaps,
    scientificConflicts: allConflicts,
    overallRisk,
    recommendation,
    evidenceScope,
    evidenceSummary,
    evidenceConsistency,
  };
}

/**
 * 原料相关性匹配：在产品描述文本中查找原料（含别名）。
 *
 * 匹配规则：
 * - CJK 名称（如「骆驼奶」「胶原蛋白肽」）按子串匹配；
 * - ASCII 名称（AKG、HMB、Akkermansia）按词边界匹配，避免「AKGx」这类前缀误伤
 *   （反例：产品名含「AKG」会命中，含「MARKII」不会误命中「AKG」的子串）。
 *
 * 诚实口径：匹配不上就是匹配不上，返回空数组，由调用方如实说明证据范围缺口。
 */
export function matchRelevantIngredients(
  ingredients: ScientificEvidenceInput[],
  searchText: string
): ScientificEvidenceInput[] {
  const haystack = searchText.toLowerCase();
  return ingredients.filter((i) => {
    const terms = [i.ingredient, ...(i.aliases || [])].filter(Boolean);
    return terms.some((term) => {
      const t = term.toLowerCase();
      if (!t) return false;
      // ASCII 词按词边界，CJK 词按子串
      if (/^[a-z0-9\-+ ]+$/i.test(t)) {
        return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(haystack);
      }
      return haystack.includes(t);
    });
  });
}

export function parseIngredientFrontmatter(
  frontmatter: Record<string, string>,
  filename: string
): ScientificEvidenceInput | null {
  const ingredient = frontmatter.ingredient?.trim() || filename.replace(/\.md$/, "");
  const claim = frontmatter.claim?.trim();
  const evidenceLevel = frontmatter.evidence_level?.trim() as ScientificEvidenceInput["evidenceLevel"];

  if (!claim || !evidenceLevel) return null;

  // aliases: 可选别名/化学名/英文名，逗号（中英文）、顿号、分号分隔；用于原料相关性匹配
  const aliases = (frontmatter.aliases || "")
    .split(/[,，、;；]/)
    .map((a) => a.trim())
    .filter(Boolean);

  const candidate: ScientificEvidenceInput = {
    ingredient,
    aliases: aliases.length > 0 ? aliases : null,
    claim,
    evidenceLevel,
    humanRCTCount: Number(frontmatter.human_rct || "0"),
    sampleSizeTotal: Number(frontmatter.sample_size || "0"),
    doseRange: frontmatter.dose?.trim() || null,
    mechanism: frontmatter.mechanism?.trim() || null,
    applicablePopulation: frontmatter.applicable_population?.trim() || null,
    marketingSay: frontmatter.marketing_say?.trim() || null,
    marketingNever: frontmatter.marketing_never?.trim() || null,
    confidence: Number(frontmatter.confidence || "0"),
    lastReviewed: frontmatter.last_reviewed?.trim() || new Date().toISOString().slice(0, 10),
    status: (frontmatter.status?.trim() as ScientificEvidenceInput["status"]) || "DRAFT",
  };

  try {
    return normalizeScientificEvidence(candidate, 0);
  } catch {
    // 非法 evidence card 不应进入挑战决策；调用方会把它视为未匹配证据。
    return null;
  }
}
