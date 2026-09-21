/**
 * 利润指标计算（纯函数）
 *
 * 三个核心指标：
 *   - 净利率 %   = 净利润 / 不含税结算销售额 × 100
 *   - BOM 毛利率 % = (售价 - 含损耗 BOM) / 售价 × 100
 *   - 盈亏平衡量 = 月固定成本 / (售价 - 单件可变成本)
 *
 * 红线（源自现有 bom.ts alerts）：
 *   - BOM 毛利率 ≥ 65%
 *   - 净利率 ≥ 20%
 */

import type { CostInput, ProfitMetrics, TaxResult, TotalCostResult } from './types'
import { round2 } from './types'
import { applyDefaults } from './presets'

export interface CalcProfitMetricsDeps {
  totalCost: TotalCostResult
  tax: TaxResult
}

/**
 * 计算利润指标
 *
 * @param input 成本输入
 * @param deps 依赖：总成本 + 税费结果
 *
 * @example
 *   const m = calcProfitMetrics(input, { totalCost, tax })
 *   // → { netMarginRate: 25.3, bomMarginRate: 70.5, breakevenUnits: 1200 }
 */
export function calcProfitMetrics(
  input: CostInput,
  deps: CalcProfitMetricsDeps
): ProfitMetrics {
  const i = applyDefaults(input)
  const { totalCost, tax } = deps

  // 净利率：净利润 / 不含税结算销售额 × 100
  // 注意分母用不含税销售额（与会计口径一致）
  const denom = tax.settlementSalesExclVat || 0
  const netMarginRate = denom > 0
    ? round2((tax.netProfit / denom) * 100)
    : 0

  // BOM 毛利率：(售价 - 含损耗 BOM) / 售价 × 100
  // BOM 成本 = L1 + L2 + L3 + L4（含损耗、含运费）
  const retailPrice = i.retailPrice || 0
  const bomMarginRate = retailPrice > 0
    ? round2(((retailPrice - totalCost.totalBomCost) / retailPrice) * 100)
    : 0

  // 盈亏平衡量：月固定成本 / 单件边际贡献
  // 单件边际贡献 = 售价 - 单件可变成本
  // 可变成本 = BOM 成本 + 渠道费用（不含固定成本分摊）
  const unitVariableCost = round2(totalCost.totalBomCost + totalCost.totalChannelCost)
  const unitContribution = round2(retailPrice - unitVariableCost)
  const breakevenUnits = unitContribution > 0
    ? Math.ceil(i.monthlyFixed / unitContribution)
    : 0

  return {
    netMarginRate,
    bomMarginRate,
    breakevenUnits,
  }
}
