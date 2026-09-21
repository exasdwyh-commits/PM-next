/**
 * 产品维度评分规则（蓝图 §4.4）
 *
 * 重要定位说明（避免被误读为市场验证结论）：
 * - 这里的权重与阈值是**产品规则提案，不是行业标准**，规则版本随 Scorecard 一起保存，允许以后调整。
 * - 这里的 score 是「按规则合成的维度准备度」，用于**定位改进方向**，不替代投资判断。
 * - 未知项一律保持 null：不默认 0、不补造数值。
 * - 覆盖率不足时标 provisional（暂评），且不得进入可直接排序的完整评分榜。
 */

import { AnalysisDimensionKey } from "@prisma/client";
import { SCORE_DIMENSION_LABELS } from "@/shared/status-labels";

export const SCORE_RULE_VERSION = "v1";

/** 起始权重（百分比，合计 100）。蓝图 §4.4 的提案值。 */
export const DIMENSION_WEIGHTS: Record<AnalysisDimensionKey, number> = {
  DEMAND_VALUE: 25,
  DIFFERENTIATION: 20,
  UNIT_ECONOMICS: 20,
  COMPANY_FIT: 15,
  DELIVERY_FEASIBILITY: 10,
  LAUNCH_READINESS: 10,
};

/**
 * 维度中文标签：唯一来源在 `src/shared/status-labels.ts`。
 * 此前这份表在 scoring / revision-panel / product-overview / briefing 各存一份，
 * 维度改名时极易只改一处。此处保留 `Record<AnalysisDimensionKey>` 的类型约束，
 * 键是否齐全由 `tests/status-labels.test.ts` 守卫 6 兜住。
 */
export const DIMENSION_LABELS: Record<AnalysisDimensionKey, string> = SCORE_DIMENSION_LABELS;

export const DIMENSION_ORDER: AnalysisDimensionKey[] = [
  "DEMAND_VALUE",
  "DIFFERENTIATION",
  "UNIT_ECONOMICS",
  "COMPANY_FIT",
  "DELIVERY_FEASIBILITY",
  "LAUNCH_READINESS",
];

/** 覆盖率低于该阈值即为「暂评」，不允许进入可直接排序的完整榜 */
export const PROVISIONAL_COVERAGE_THRESHOLD = 0.8;

export interface ScorecardResult {
  weights: Record<string, number>;
  ruleVersion: string;
  coverageRatio: number;
  provisional: boolean;
  /** 按已评维度权重归一化；无任何已评维度时为 null */
  weightedScore: number | null;
}

export function computeScorecard(
  dimensions: { dimension: AnalysisDimensionKey; score: number | null }[],
  ruleVersion: string = SCORE_RULE_VERSION
): ScorecardResult {
  const totalWeight = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  let ratedWeight = 0;
  let weightedSum = 0;

  for (const d of dimensions) {
    if (d.score === null || d.score === undefined) continue;
    const w = DIMENSION_WEIGHTS[d.dimension] ?? 0;
    ratedWeight += w;
    weightedSum += d.score * w;
  }

  const coverageRatio = totalWeight > 0 ? ratedWeight / totalWeight : 0;
  const weightedScore = ratedWeight > 0 ? Math.round((weightedSum / ratedWeight) * 10) / 10 : null;

  return {
    weights: { ...DIMENSION_WEIGHTS },
    ruleVersion,
    coverageRatio: Math.round(coverageRatio * 1000) / 1000,
    provisional: coverageRatio < PROVISIONAL_COVERAGE_THRESHOLD,
    weightedScore,
  };
}

/**
 * 证据覆盖型维度的统一打分：按「必需字段覆盖数 / 必需字段总数」线性给分，上限 90。
 * 覆盖为 0 时返回 null（未知就是未知，不给 0 分）。
 */
export function coverageScore(
  requiredFields: string[],
  coveredFields: Set<string>
): { score: number | null; covered: string[]; missing: string[] } {
  const covered = requiredFields.filter((f) => coveredFields.has(f));
  const missing = requiredFields.filter((f) => !coveredFields.has(f));
  if (covered.length === 0) return { score: null, covered, missing };
  const ratio = covered.length / requiredFields.length;
  return { score: Math.round(Math.min(90, ratio * 90)), covered, missing };
}

/**
 * 单位经济性：由代码计算毛利，再按固定档位映射为准备度分。
 * 金额永远由确定性代码算，不由模型估。
 */
export function grossMarginScore(
  price: number,
  cost: number
): { score: number; grossMargin: number; band: string } | null {
  if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return null;
  const grossMargin = (price - cost) / price;
  const pct = grossMargin * 100;
  let score: number;
  let band: string;
  if (pct >= 60) { score = 90; band = "毛利率 ≥ 60%"; }
  else if (pct >= 50) { score = 80; band = "毛利率 50–60%"; }
  else if (pct >= 40) { score = 70; band = "毛利率 40–50%"; }
  else if (pct >= 30) { score = 55; band = "毛利率 30–40%"; }
  else { score = 35; band = "毛利率 < 30%"; }
  return { score, grossMargin: Math.round(grossMargin * 1000) / 1000, band };
}

/** 从自由文本里抽出第一个数字（用于 priceExpectation / targetCost 这类录入字段） */
export function parseAmount(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = String(input).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
