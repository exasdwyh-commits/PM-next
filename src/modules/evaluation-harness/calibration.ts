import type {
  ExperienceLessonCandidate,
  FrozenDecisionIdentity,
  ProductValidationOutcome,
  VerifiedProductOutcome,
} from "./types";
import type {
  PotentialDimensionKey,
  PotentialEvidenceState,
  PotentialVerdict,
} from "../product-development/potential-assessment";

export interface FrozenPotentialPrediction {
  identity: FrozenDecisionIdentity;
  verdict: PotentialVerdict;
  diagnosticIndex: number | null;
  coverageRatio: number;
  verifiedCoverageRatio: number;
  dimensions: Array<{
    key: PotentialDimensionKey;
    score: number | null;
    evidenceState: PotentialEvidenceState;
  }>;
}

export interface BacktestRecord {
  prediction: FrozenPotentialPrediction;
  outcome: VerifiedProductOutcome;
}

export type BacktestAlignment =
  | "ALIGNED_SUCCESS"
  | "ALIGNED_FAILURE"
  | "FALSE_POSITIVE"
  | "FALSE_NEGATIVE"
  | "ABSTAINED"
  | "INCONCLUSIVE"
  | "IDENTITY_MISMATCH"
  | "UNVERIFIED_OUTCOME";

export interface BacktestEvaluation {
  alignment: BacktestAlignment;
  comparable: boolean;
  reason: string;
}

function sameIdentity(
  prediction: FrozenDecisionIdentity,
  outcome: FrozenDecisionIdentity
): boolean {
  return (
    prediction.organizationId === outcome.organizationId &&
    prediction.productId === outcome.productId &&
    prediction.productVersionId === outcome.productVersionId &&
    prediction.productVersionFingerprint ===
      outcome.productVersionFingerprint &&
    (prediction.channelRouteId ?? null) ===
      (outcome.channelRouteId ?? null) &&
    (prediction.channelRouteFingerprint ?? null) ===
      (outcome.channelRouteFingerprint ?? null)
  );
}

function isOutcomeVerified(outcome: VerifiedProductOutcome): boolean {
  return (
    outcome.evidenceRefs.length > 0 &&
    !!outcome.verifiedByUserId &&
    !!outcome.verifiedAt
  );
}

function isPositiveVerdict(verdict: PotentialVerdict): boolean {
  return verdict === "VALIDATE" || verdict === "PRIORITIZE_FOR_VALIDATION";
}

function isNegativeVerdict(verdict: PotentialVerdict): boolean {
  return verdict === "DEPRIORITIZE" || verdict === "BLOCKED";
}

export function evaluatePredictionAgainstOutcome(
  record: BacktestRecord
): BacktestEvaluation {
  if (!sameIdentity(record.prediction.identity, record.outcome.identity)) {
    return {
      alignment: "IDENTITY_MISMATCH",
      comparable: false,
      reason:
        "预测与结果不属于同一产品版本/渠道路线指纹，禁止把改版后的结果用于校准旧预测",
    };
  }

  if (!isOutcomeVerified(record.outcome)) {
    return {
      alignment: "UNVERIFIED_OUTCOME",
      comparable: false,
      reason: "真实结果缺少证据引用或人工核实，不可作为经验标签",
    };
  }

  if (
    record.outcome.outcome === "INCONCLUSIVE" ||
    record.outcome.outcome === "NOT_RUN"
  ) {
    return {
      alignment: "INCONCLUSIVE",
      comparable: false,
      reason: "验证未形成可比较结果",
    };
  }

  if (record.prediction.verdict === "NEEDS_EVIDENCE") {
    return {
      alignment: "ABSTAINED",
      comparable: true,
      reason: "系统选择补证而非下注；记录结果用于后续评估 abstention 质量",
    };
  }

  const positive = isPositiveVerdict(record.prediction.verdict);
  const negative = isNegativeVerdict(record.prediction.verdict);
  const success = record.outcome.outcome === "SUCCESS";
  const failure = record.outcome.outcome === "FAILURE";

  if (positive && success) {
    return {
      alignment: "ALIGNED_SUCCESS",
      comparable: true,
      reason: "推进类判断与真实验证成功一致",
    };
  }
  if (positive && failure) {
    return {
      alignment: "FALSE_POSITIVE",
      comparable: true,
      reason: "系统建议推进，但真实验证失败",
    };
  }
  if (negative && failure) {
    return {
      alignment: "ALIGNED_FAILURE",
      comparable: true,
      reason: "负向判断与真实验证失败一致",
    };
  }
  if (negative && success) {
    return {
      alignment: "FALSE_NEGATIVE",
      comparable: true,
      reason: "系统负向判断，但同版本同渠道路线的真实验证成功",
    };
  }

  return {
    alignment: "INCONCLUSIVE",
    comparable: false,
    reason: "当前 verdict/outcome 组合无法形成可靠校准标签",
  };
}

export interface BacktestSummary {
  total: number;
  comparable: number;
  aligned: number;
  falsePositive: number;
  falseNegative: number;
  abstained: number;
  inconclusive: number;
  identityMismatch: number;
  unverifiedOutcome: number;
}

export function summarizeBacktests(
  records: BacktestRecord[]
): BacktestSummary {
  const summary: BacktestSummary = {
    total: records.length,
    comparable: 0,
    aligned: 0,
    falsePositive: 0,
    falseNegative: 0,
    abstained: 0,
    inconclusive: 0,
    identityMismatch: 0,
    unverifiedOutcome: 0,
  };

  for (const record of records) {
    const result = evaluatePredictionAgainstOutcome(record);
    if (result.comparable) summary.comparable += 1;
    if (
      result.alignment === "ALIGNED_SUCCESS" ||
      result.alignment === "ALIGNED_FAILURE"
    ) {
      summary.aligned += 1;
    } else if (result.alignment === "FALSE_POSITIVE") {
      summary.falsePositive += 1;
    } else if (result.alignment === "FALSE_NEGATIVE") {
      summary.falseNegative += 1;
    } else if (result.alignment === "ABSTAINED") {
      summary.abstained += 1;
    } else if (result.alignment === "IDENTITY_MISMATCH") {
      summary.identityMismatch += 1;
    } else if (result.alignment === "UNVERIFIED_OUTCOME") {
      summary.unverifiedOutcome += 1;
    } else {
      summary.inconclusive += 1;
    }
  }

  return summary;
}

export interface DimensionReliabilityObservation {
  segmentKey: string;
  dimensionKey: PotentialDimensionKey;
  score: number;
  outcome: Extract<ProductValidationOutcome, "SUCCESS" | "FAILURE">;
  evidenceRefs: string[];
}

/**
 * 只生成“待复核经验”，绝不直接返回新权重。
 *
 * 当前简单口径：比较同一 segment + dimension 在成功/失败样本中的平均分差。
 * 以后可替换成更严谨的统计方法，但这个接口保持“候选经验 -> 审核 -> 政策变更”边界。
 */
export function buildDimensionReliabilityLesson(params: {
  observations: DimensionReliabilityObservation[];
  segmentKey: string;
  dimensionKey: PotentialDimensionKey;
  minSampleSize?: number;
  minMeanGap?: number;
}): ExperienceLessonCandidate {
  const minSampleSize = params.minSampleSize ?? 20;
  const minMeanGap = params.minMeanGap ?? 10;

  const rows = params.observations.filter(
    (row) =>
      row.segmentKey === params.segmentKey &&
      row.dimensionKey === params.dimensionKey
  );

  const success = rows.filter((row) => row.outcome === "SUCCESS");
  const failure = rows.filter((row) => row.outcome === "FAILURE");

  const mean = (items: DimensionReliabilityObservation[]) =>
    items.length === 0
      ? null
      : items.reduce((sum, item) => sum + item.score, 0) / items.length;

  const successMean = mean(success);
  const failureMean = mean(failure);
  const gap =
    successMean !== null && failureMean !== null
      ? successMean - failureMean
      : null;

  const enoughSamples =
    rows.length >= minSampleSize &&
    success.length > 0 &&
    failure.length > 0;
  const discriminative = gap !== null && Math.abs(gap) >= minMeanGap;

  const limitations: string[] = [];
  if (rows.length < minSampleSize) {
    limitations.push(
      `样本量 ${rows.length} 小于最低要求 ${minSampleSize}`
    );
  }
  if (success.length === 0 || failure.length === 0) {
    limitations.push("样本缺少成功或失败对照组");
  }
  if (gap !== null && Math.abs(gap) < minMeanGap) {
    limitations.push(
      `成功/失败均分差仅 ${gap.toFixed(1)}，不足以支持调整该维度影响力`
    );
  }
  limitations.push(
    "相关性不等于因果；渠道、品类、时间窗口变化仍需分层复核"
  );

  const statement =
    gap === null
      ? `${params.segmentKey} / ${params.dimensionKey} 暂无可比较的成功失败样本`
      : `${params.segmentKey} / ${params.dimensionKey}：成功样本均分 ${successMean!.toFixed(
          1
        )}，失败样本均分 ${failureMean!.toFixed(1)}，差值 ${gap.toFixed(1)}`;

  return {
    key: `dimension-reliability:${params.segmentKey}:${params.dimensionKey}`,
    segmentKey: params.segmentKey,
    statement,
    supportCount: success.length,
    contradictionCount: failure.length,
    sampleSize: rows.length,
    evidenceRefs: [...new Set(rows.flatMap((row) => row.evidenceRefs))],
    status: "CANDIDATE",
    readyForReview: enoughSamples && discriminative,
    limitations,
  };
}
