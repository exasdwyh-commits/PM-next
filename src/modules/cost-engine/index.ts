/**
 * 运营成本核算与供货定价模块 — 计算引擎统一入口
 *
 * 设计原则：
 *   1. 机械化计算：所有数值由纯函数算出，AI 不参与
 *   2. AI 仅辅助自检：通过 runSelfCheck 输出告警提示，不修改数值
 *   3. 模块解耦：freight / channel / cost-total / tax / supply-price / profit / budget / self-check
 *      各自独立可测，index 只负责按依赖顺序编排
 *
 * 调用顺序（依赖链）：
 *   1. freight       = calcFreight(input)                      // 无依赖
 *   2. channel       = calcChannelCost(input)                  // 无依赖
 *   3. totalCost     = calcTotalCost(input, { freight, channel })
 *   4. tax           = calcTax(input, { freight, channel, totalCost })
 *   5. supplyPrice   = calcSupplyPrice(input, { totalCost: totalCost.totalCost })
 *   6. profitMetrics = calcProfitMetrics(input, { totalCost, tax })
 *   7. budgetVar     = calcBudgetVariance(input, { totalCost })
 *   8. alerts        = checkCost(input, result)                // 最后跑自检
 *
 * @example 基本用法
 *   import { calcCost } from '@/lib/cost-engine'
 *   const result = calcCost({
 *     retailPrice: 69, materialCost: 8.05, packagingCost: 1.2,
 *     manufacturingCost: 1.5, certificationCost: 0.3,
 *     platformFeeRate: 2, commissionRate: 40, marketingRate: 8, monthlyFixed: 5000,
 *     channel: 'XINXUAN', invoiceType: '达人开票',
 *     marketReferencePrice: 89, pricingStrategy: 'MARKET_FOLLOW',
 *   })
 *   // result.alerts → 自检告警列表
 */

import type { CostInput, CostResult } from './types'
import { calcFreight } from './freight'
import { calcChannelCost } from './channel'
import { calcTotalCost } from './cost-total'
import { calcTax } from './tax'
import { calcSupplyPrice } from './supply-price'
import { calcProfitMetrics } from './profit-metrics'
import { calcBudgetVariance } from './budget-variance'
import { checkCost } from './self-check'

/**
 * 计算成本（统一入口）
 *
 * @param input 成本输入（无需提前应用默认值，内部会调 applyDefaults）
 * @returns 完整成本结果（六层成本 + 16 项税费 + 利润指标 + 供货价 + 预算差异 + 自检告警）
 */
export function calcCost(input: CostInput): CostResult {
  // 1. 运费
  const freight = calcFreight(input)

  // 2. 渠道费用
  const channel = calcChannelCost(input)

  // 3. 总成本（六层结构）
  const totalCost = calcTotalCost(input, { freight, channel })

  // 4. 税费（16 项）
  const tax = calcTax(input, { freight, channel, totalCost })

  // 5. 供货价定价
  const supplyPrice = calcSupplyPrice(input, { totalCost: totalCost.totalCost })

  // 6. 利润指标
  const profitMetrics = calcProfitMetrics(input, { totalCost, tax })

  // 7. 预算对比
  const budgetVariance = calcBudgetVariance(input, { totalCost })

  // 8. 不含税快递费（用于报表展示）
  const freightExclVat = freight.baseFreight

  // 9. 组装结果
  const result: CostResult = {
    ...totalCost,
    ...tax,
    ...profitMetrics,
    ...supplyPrice,
    ...budgetVariance,
    purchaseCostExclVat: totalCost.purchaseCostExclVat,
    freightExclVat,
    alerts: [],
  }

  // 10. 自检（最后跑，基于完整结果）
  result.alerts = checkCost(input, result)

  return result
}

// ── 重导出常用 API ─────────────────────────────────────
export * from './types'
export { calcFreight } from './freight'
export { calcChannelCost } from './channel'
export { calcTotalCost } from './cost-total'
export { calcTax } from './tax'
export { calcSupplyPrice } from './supply-price'
export { calcProfitMetrics } from './profit-metrics'
export { calcBudgetVariance } from './budget-variance'
export { runSelfCheck, checkCost } from './self-check'
export {
  CHANNEL_PRESETS,
  CATEGORY_TARGET_MARGIN,
  applyDefaults,
  applyChannelPreset,
  DEFAULT_FREIGHT_BASE,
  DEFAULT_COLD_CHAIN_EXTRA,
  DEFAULT_GOODS_VAT_RATE,
  DEFAULT_SERVICE_VAT_RATE,
  DEFAULT_SURTAX_RATE,
  DEFAULT_INCOME_TAX_RATE,
  DEFAULT_TARGET_MARGIN_RATE,
  DEFAULT_PRICING_STRATEGY,
} from './presets'
