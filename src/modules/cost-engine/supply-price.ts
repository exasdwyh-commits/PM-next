/**
 * 供货价定价引擎（纯函数）
 *
 * 业务逻辑（源自用户描述的 GABA 例子）：
 *   - 不是简单成本加成，而是"成本优势度 + 市场锚定"
 *   - 同时算出三个价：保底（不亏）、建议（合理）、顶价（不超市场）
 *
 * 三种定价策略：
 *   - CONSERVATIVE（保守）：只赚目标利润，建议价 = 保底价
 *   - MARKET_FOLLOW（跟随市场）：建议价 = min(市场价×0.8, 保底价×1.5)
 *   - AGGRESSIVE（激进）：基于成本优势度动态定价
 *       score >= 70 → 市场价 × 0.75
 *       score 40-70 → 市场价 × 0.65
 *       score  < 40 → 保底价
 *
 * 最终报价 = clamp(人工调整值, 保底价, 顶价)
 */

import type { CostInput, SupplyPriceResult } from './types'
import { round2 } from './types'
import { applyDefaults } from './presets'

export interface CalcSupplyPriceDeps {
  /** 总成本（不含税，来自 TotalCostResult.totalCost） */
  totalCost: number
}

/**
 * 计算供货价（保底/建议/顶价/最终）
 *
 * @param input 成本输入
 * @param deps 依赖：总成本
 *
 * @example GABA 例子（修正版）
 *   const r = calcSupplyPrice({
 *     retailPrice: 200, marketReferencePrice: 200,
 *     targetMarginRate: 30, pricingStrategy: 'AGGRESSIVE', costAdvantageScore: 85,
 *     channel: 'YUANFANG', invoiceType: '达人开票',
 *     materialCost: 85, packagingCost: 0, manufacturingCost: 0, certificationCost: 0,
 *     platformFeeRate: 0, commissionRate: 0, marketingRate: 0, monthlyFixed: 0,
 *   }, { totalCost: 85 })
 *   // → { supplyPriceFloor: 110.5, supplyPriceSuggested: 150, supplyPriceCeiling: 190, ... }
 */
export function calcSupplyPrice(
  input: CostInput,
  deps: CalcSupplyPriceDeps
): SupplyPriceResult {
  const i = applyDefaults(input)
  const { totalCost } = deps

  const targetMarginRate = i.targetMarginRate!
  const strategy = i.pricingStrategy!
  const market = i.marketReferencePrice
  const score = i.costAdvantageScore ?? 0

  // ── 保底价：成本 × (1 + 目标利润率) ──
  const supplyPriceFloor = round2(totalCost * (1 + targetMarginRate / 100))

  // ── 顶价：市场参考价 × 0.95（留 5% 谈判空间）──
  // 若无市场参考价，顶价 = 保底价 × 2（兜底，避免无上限）
  const supplyPriceCeiling = market
    ? round2(market * 0.95)
    : round2(supplyPriceFloor * 2)

  // ── 建议价：按策略计算 ──
  let suggested: number
  if (!market) {
    // 无市场参考价，所有策略都退化为保底价
    suggested = supplyPriceFloor
  } else {
    switch (strategy) {
      case 'CONSERVATIVE':
        // 保守：只赚目标利润
        suggested = supplyPriceFloor
        break
      case 'MARKET_FOLLOW':
        // 跟随市场：min(市场价×0.8, 保底价×1.5)
        suggested = Math.min(market * 0.8, supplyPriceFloor * 1.5)
        break
      case 'AGGRESSIVE':
        // 激进：按成本优势度动态定价
        if (score >= 70) {
          suggested = market * 0.75
        } else if (score >= 40) {
          suggested = market * 0.65
        } else {
          suggested = supplyPriceFloor
        }
        break
      default:
        suggested = supplyPriceFloor
    }
  }
  const supplyPriceSuggested = round2(suggested)

  // ── 最终报价：人工调整，clamp 到 [保底, 顶价] ──
  // 未填 finalSupplyPrice 时，默认等于建议价
  // 但若建议价 < 保底价（亏损场景），最终报价也至少 = 保底价
  const rawFinal = i.finalSupplyPrice ?? supplyPriceSuggested
  const clampedFinal = Math.max(
    Math.min(rawFinal, supplyPriceCeiling),
    supplyPriceFloor
  )
  const finalSupplyPrice = round2(clampedFinal)

  return {
    supplyPriceFloor,
    supplyPriceSuggested,
    supplyPriceCeiling,
    finalSupplyPrice,
  }
}
