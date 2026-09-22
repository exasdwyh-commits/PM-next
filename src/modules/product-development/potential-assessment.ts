/**
 * 产品潜力评估 V2
 *
 * 与旧 Scorecard 的关系：
 * - 旧 Scorecard 继续用于“准备度/改进方向”；
 * - 本模块用于“是否值得继续验证”的产品潜力判断；
 * - 硬门槛先于任何加权分，失败项不得被其它高分抵消；
 * - 潜力分只是已知信息下的诊断指标，不是市场成功概率。
 */

export const PRODUCT_POTENTIAL_RULE_VERSION = "product-potential/v2";

export type PotentialEvidenceState =
  | "VERIFIED"
  | "SUPPORTED"
  | "ASSUMED"
  | "UNKNOWN";

export type PotentialDimensionKey =
  | "DEMAND"
  | "CHANNEL_FIT"
  | "UNIT_ECONOMICS"
  | "DIFFERENTIATION"
  | "REPEAT_PURCHASE"
  | "DELIVERY_FEASIBILITY"
  | "COMPANY_FIT";

export type PotentialGateStatus = "PASS" | "FAIL" | "UNKNOWN";

export type PotentialVerdict =
  | "BLOCKED"
  | "NEEDS_EVIDENCE"
  | "DEPRIORITIZE"
  | "VALIDATE"
  | "PRIORITIZE_FOR_VALIDATION";

export interface PotentialDimensionInput {
  key: PotentialDimensionKey;
  /** 0-100；未知必须传 null，不允许用 0 冒充未知。 */
  score: number | null;
  evidenceState: PotentialEvidenceState;
  rationale: string;
  sourceRefs: string[];
}

export interface PotentialGateInput {
  key: string;
  label: string;
  status: PotentialGateStatus;
  reason: string;
  sourceRefs: string[];
}

export interface ProductPotentialInput {
  dimensions: PotentialDimensionInput[];
  gates: PotentialGateInput[];
  /** 是否已有负责人确认过的真实市场验证。 */
  marketValidationVerified: boolean;
}

export interface ProductPotentialAssessment {
  verdict: PotentialVerdict;
  blockers: PotentialGateInput[];
  unknownGates: PotentialGateInput[];

  coverageRatio: number;
  verifiedCoverageRatio: number;

  /**
   * 已知维度的诊断指数；不是市场成功概率。
   * 覆盖不足时仍可展示，但 verdict 会保持 NEEDS_EVIDENCE。
   */
  diagnosticIndex: number | null;

  confidenceBand: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
}

const WEIGHTS: Record<PotentialDimensionKey, number> = {
  DEMAND: 24,
  CHANNEL_FIT: 18,
  UNIT_ECONOMICS: 18,
  DIFFERENTIATION: 14,
  REPEAT_PURCHASE: 10,
  DELIVERY_FEASIBILITY: 8,
  COMPANY_FIT: 8,
};

const EVIDENCE_FACTOR: Record<PotentialEvidenceState, number> = {
  VERIFIED: 1,
  SUPPORTED: 0.9,
  ASSUMED: 0.6,
  UNKNOWN: 0,
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isValidScore(score: number | null): boolean {
  return score === null || (Number.isFinite(score) && score >= 0 && score <= 100);
}

export function assessProductPotential(
  input: ProductPotentialInput
): ProductPotentialAssessment {
  const blockers = input.gates.filter((gate) => gate.status === "FAIL");
  const unknownGates = input.gates.filter((gate) => gate.status === "UNKNOWN");

  const reasons: string[] = [];

  for (const dimension of input.dimensions) {
    if (!isValidScore(dimension.score)) {
      throw new Error(`维度 ${dimension.key} 的 score 必须为 null 或 0-100`);
    }
    if (dimension.score === null && dimension.evidenceState !== "UNKNOWN") {
      throw new Error(
        `维度 ${dimension.key} 未知时 evidenceState 必须为 UNKNOWN`
      );
    }
  }

  if (blockers.length > 0) {
    reasons.push(
      `存在 ${blockers.length} 个硬门槛失败：${blockers
        .map((item) => item.label)
        .join("、")}`
    );
  }

  const totalWeight = Object.values(WEIGHTS).reduce((sum, value) => sum + value, 0);
  let knownWeight = 0;
  let verifiedWeight = 0;
  let weightedSum = 0;
  let evidenceAdjustedWeight = 0;

  const seen = new Set<PotentialDimensionKey>();
  for (const dimension of input.dimensions) {
    if (seen.has(dimension.key)) {
      throw new Error(`潜力维度重复：${dimension.key}`);
    }
    seen.add(dimension.key);

    const weight = WEIGHTS[dimension.key];
    if (dimension.score === null || dimension.evidenceState === "UNKNOWN") {
      continue;
    }

    knownWeight += weight;
    if (dimension.evidenceState === "VERIFIED") {
      verifiedWeight += weight;
    }

    const factor = EVIDENCE_FACTOR[dimension.evidenceState];
    weightedSum += dimension.score * weight * factor;
    evidenceAdjustedWeight += weight * factor;
  }

  const coverageRatio = totalWeight > 0 ? knownWeight / totalWeight : 0;
  const verifiedCoverageRatio =
    totalWeight > 0 ? verifiedWeight / totalWeight : 0;
  const diagnosticIndex =
    evidenceAdjustedWeight > 0
      ? round1(weightedSum / evidenceAdjustedWeight)
      : null;

  let confidenceBand: ProductPotentialAssessment["confidenceBand"] = "LOW";
  if (coverageRatio >= 0.85 && verifiedCoverageRatio >= 0.55) {
    confidenceBand = "HIGH";
  } else if (coverageRatio >= 0.7 && verifiedCoverageRatio >= 0.3) {
    confidenceBand = "MEDIUM";
  }

  let verdict: PotentialVerdict;

  if (blockers.length > 0) {
    verdict = "BLOCKED";
  } else if (unknownGates.length > 0) {
    verdict = "NEEDS_EVIDENCE";
    reasons.push(
      `仍有 ${unknownGates.length} 个关键门槛未知，不能用评分代替缺失事实`
    );
  } else if (coverageRatio < 0.7 || diagnosticIndex === null) {
    verdict = "NEEDS_EVIDENCE";
    reasons.push("关键维度覆盖不足 70%，当前只能继续补证，不能形成产品优先级结论");
  } else if (diagnosticIndex < 55) {
    verdict = "DEPRIORITIZE";
    reasons.push(`诊断指数 ${diagnosticIndex} 偏弱，优先修正路线或降低投入`);
  } else if (
    diagnosticIndex >= 75 &&
    input.marketValidationVerified &&
    verifiedCoverageRatio >= 0.55
  ) {
    verdict = "PRIORITIZE_FOR_VALIDATION";
    reasons.push(
      "诊断表现较强且已有真实市场验证，可提高验证优先级；该结论仍不等于批准上市"
    );
  } else {
    verdict = "VALIDATE";
    reasons.push(
      "当前信息支持继续做低成本验证，但尚不足以把产品潜力当成已验证事实"
    );
  }

  return {
    verdict,
    blockers,
    unknownGates,
    coverageRatio: round3(coverageRatio),
    verifiedCoverageRatio: round3(verifiedCoverageRatio),
    diagnosticIndex,
    confidenceBand,
    reasons,
  };
}

export const PRODUCT_POTENTIAL_WEIGHTS = { ...WEIGHTS };
