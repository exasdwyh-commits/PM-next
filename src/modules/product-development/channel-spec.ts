/**
 * 渠道规格适配引擎
 *
 * 目标：把“渠道费用计算”升级为“渠道约束反向校验规格”。
 *
 * 设计原则：
 * - 不让模型直接计算利润或决定规格是否成立；
 * - 渠道规则必须显式传入并带版本/可信状态，禁止把预设当成事实；
 * - 同一产品允许针对不同渠道形成不同规格路线；
 * - 硬性渠道/经济性不满足时返回 blocker，不能被其它评分平均掉。
 */

export type ChannelRuleStatus = "CONFIRMED" | "ASSUMED";

export interface ChannelRuleProfile {
  key: string;
  label: string;
  version: string;
  status: ChannelRuleStatus;
  sourceRefs: string[];

  minRetailPrice?: number | null;
  maxRetailPrice?: number | null;
  minBundleQuantity?: number | null;
  maxBundleQuantity?: number | null;
  allowedUnitLabels?: string[];

  commissionRate: number;
  platformFeeRate: number;
  marketingRate: number;
  managementFeeRate: number;
  returnRate: number;
  returnHandlingFeeRate: number;

  /** 目标订单贡献毛利率（百分比），用于反推最大可承受产品成本。 */
  targetContributionMarginRate: number;

  /** 纯业务约束说明，如“直播间主推必须支持多盒机制”。不参与数值计算。 */
  constraints?: string[];
}

export interface ChannelSpecCandidate {
  id: string;
  retailPrice: number;
  bundleQuantity: number;
  unitLabel: string;

  /** 单个售卖单元的产品成本，不含订单级包装/运费。 */
  productCostPerUnit: number;
  packagingCostPerOrder: number;
  freightCostPerOrder: number;
}

export interface ChannelSpecEvaluation {
  candidateId: string;
  channelKey: string;
  ruleVersion: string;
  ruleStatus: ChannelRuleStatus;

  feasible: boolean;
  blockers: string[];
  warnings: string[];

  pricePerUnit: number;
  channelTakeRate: number;
  expectedChannelCost: number;
  landedProductCost: number;
  contribution: number;
  contributionMarginRate: number;
  requiredMaxProductCostPerUnit: number | null;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function validateRate(name: string, value: number, blockers: string[]) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    blockers.push(`${name} 必须在 0-100 之间`);
  }
}

export function evaluateChannelSpecCandidate(
  candidate: ChannelSpecCandidate,
  rule: ChannelRuleProfile
): ChannelSpecEvaluation {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(candidate.retailPrice) || candidate.retailPrice <= 0) {
    blockers.push("零售价必须大于 0");
  }
  if (!Number.isInteger(candidate.bundleQuantity) || candidate.bundleQuantity <= 0) {
    blockers.push("组合数量必须为正整数");
  }
  if (!candidate.unitLabel.trim()) {
    blockers.push("售卖单位不能为空");
  }
  if (!finiteNonNegative(candidate.productCostPerUnit)) {
    blockers.push("单元产品成本必须为非负数");
  }
  if (!finiteNonNegative(candidate.packagingCostPerOrder)) {
    blockers.push("订单包装成本必须为非负数");
  }
  if (!finiteNonNegative(candidate.freightCostPerOrder)) {
    blockers.push("订单运费必须为非负数");
  }

  validateRate("佣金率", rule.commissionRate, blockers);
  validateRate("平台费率", rule.platformFeeRate, blockers);
  validateRate("推广费率", rule.marketingRate, blockers);
  validateRate("管理费率", rule.managementFeeRate, blockers);
  validateRate("退货率", rule.returnRate, blockers);
  validateRate("退货处理费率", rule.returnHandlingFeeRate, blockers);
  validateRate("目标贡献毛利率", rule.targetContributionMarginRate, blockers);

  if (
    rule.minRetailPrice != null &&
    Number.isFinite(candidate.retailPrice) &&
    candidate.retailPrice < rule.minRetailPrice
  ) {
    blockers.push(`零售价 ${candidate.retailPrice} 低于渠道下限 ${rule.minRetailPrice}`);
  }
  if (
    rule.maxRetailPrice != null &&
    Number.isFinite(candidate.retailPrice) &&
    candidate.retailPrice > rule.maxRetailPrice
  ) {
    blockers.push(`零售价 ${candidate.retailPrice} 高于渠道上限 ${rule.maxRetailPrice}`);
  }
  if (
    rule.minBundleQuantity != null &&
    Number.isFinite(candidate.bundleQuantity) &&
    candidate.bundleQuantity < rule.minBundleQuantity
  ) {
    blockers.push(`组合数量 ${candidate.bundleQuantity} 低于渠道下限 ${rule.minBundleQuantity}`);
  }
  if (
    rule.maxBundleQuantity != null &&
    Number.isFinite(candidate.bundleQuantity) &&
    candidate.bundleQuantity > rule.maxBundleQuantity
  ) {
    blockers.push(`组合数量 ${candidate.bundleQuantity} 高于渠道上限 ${rule.maxBundleQuantity}`);
  }
  if (
    rule.allowedUnitLabels?.length &&
    candidate.unitLabel &&
    !rule.allowedUnitLabels.includes(candidate.unitLabel)
  ) {
    blockers.push(`售卖单位「${candidate.unitLabel}」不在渠道允许范围内`);
  }

  if (rule.status === "ASSUMED") {
    warnings.push("当前渠道规则仍为待确认假设，评估不得视为真实渠道验证");
  }
  if (rule.sourceRefs.length === 0) {
    warnings.push("渠道规则缺少来源引用");
  }

  const returnHandlingEffectiveRate =
    (rule.returnRate * rule.returnHandlingFeeRate) / 100;
  const channelTakeRate =
    rule.commissionRate +
    rule.platformFeeRate +
    rule.marketingRate +
    rule.managementFeeRate +
    rule.returnRate +
    returnHandlingEffectiveRate;

  if (channelTakeRate >= 100) {
    blockers.push("渠道综合费率达到或超过 100%，该规则下经济性不成立");
  }

  const expectedChannelCost = finiteNonNegative(candidate.retailPrice)
    ? candidate.retailPrice * (channelTakeRate / 100)
    : 0;
  const landedProductCost =
    Math.max(0, candidate.productCostPerUnit) * Math.max(0, candidate.bundleQuantity) +
    Math.max(0, candidate.packagingCostPerOrder) +
    Math.max(0, candidate.freightCostPerOrder);

  const contribution = candidate.retailPrice - expectedChannelCost - landedProductCost;
  const contributionMarginRate =
    candidate.retailPrice > 0 ? (contribution / candidate.retailPrice) * 100 : 0;

  if (candidate.retailPrice > 0 && contribution < 0) {
    blockers.push("当前规格在渠道费用与履约成本后为负贡献");
  }
  if (
    candidate.retailPrice > 0 &&
    contributionMarginRate < rule.targetContributionMarginRate
  ) {
    blockers.push(
      `贡献毛利率 ${contributionMarginRate.toFixed(1)}% 低于渠道目标 ${rule.targetContributionMarginRate}%`
    );
  }

  const residualForProduct =
    candidate.retailPrice -
    expectedChannelCost -
    candidate.packagingCostPerOrder -
    candidate.freightCostPerOrder -
    candidate.retailPrice * (rule.targetContributionMarginRate / 100);

  const requiredMaxProductCostPerUnit =
    candidate.bundleQuantity > 0
      ? residualForProduct / candidate.bundleQuantity
      : null;

  if (
    requiredMaxProductCostPerUnit !== null &&
    requiredMaxProductCostPerUnit < 0
  ) {
    blockers.push("即使产品本体成本为 0，也无法满足当前渠道目标贡献毛利");
  }

  return {
    candidateId: candidate.id,
    channelKey: rule.key,
    ruleVersion: rule.version,
    ruleStatus: rule.status,
    feasible: blockers.length === 0,
    blockers,
    warnings,
    pricePerUnit:
      candidate.bundleQuantity > 0
        ? round2(candidate.retailPrice / candidate.bundleQuantity)
        : 0,
    channelTakeRate: round2(channelTakeRate),
    expectedChannelCost: round2(expectedChannelCost),
    landedProductCost: round2(landedProductCost),
    contribution: round2(contribution),
    contributionMarginRate: round2(contributionMarginRate),
    requiredMaxProductCostPerUnit:
      requiredMaxProductCostPerUnit === null
        ? null
        : round2(requiredMaxProductCostPerUnit),
  };
}

export function rankFeasibleChannelSpecs(
  evaluations: ChannelSpecEvaluation[]
): ChannelSpecEvaluation[] {
  return [...evaluations]
    .filter((item) => item.feasible)
    .sort((a, b) => {
      if (a.ruleStatus !== b.ruleStatus) {
        return a.ruleStatus === "CONFIRMED" ? -1 : 1;
      }
      return b.contributionMarginRate - a.contributionMarginRate;
    });
}
