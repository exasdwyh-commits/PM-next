/**
 * 渠道费用计算（纯函数）
 *
 * 公式综合自：
 * - 现有 `src/lib/bom.ts` calcBom（平台费/佣金/退货/推广）
 * - 真实表 1 `产品成本计算11`（管理费用率）
 * - 真实表 3 `辛选正大货盘`（佣金 + 平台服务费）
 *
 * 渠道费用全部按含税零售价 P 的百分比计算：
 *   平台费 = P × platformFeeRate%
 *   佣金   = P × commissionRate%
 *   推广费 = P × marketingRate%
 *   管理费 = P × managementFeeRate%
 *   退货退款额 = P × returnRate%
 *   退货处理费 = 退货退款额 × returnHandlingFeeRate%
 */

import type { CostInput, ChannelCostResult } from './types'
import { round2 } from './types'
import { applyDefaults } from './presets'

/**
 * 计算渠道费用（含税口径）
 *
 * @param input 成本输入
 * @returns 渠道费用明细 + 合计（含税）
 *
 * @example
 *   calcChannelCost({ retailPrice: 100, platformFeeRate: 2, commissionRate: 20, marketingRate: 8, returnRate: 5, returnHandlingFeeRate: 5, managementFeeRate: 0 })
 *   // → { platformFee: 2, commission: 20, returnRefund: 5, returnHandling: 0.25, marketing: 8, managementFee: 0, channelTotal: 35.25 }
 */
export function calcChannelCost(input: CostInput): ChannelCostResult {
  const i = applyDefaults(input)
  const p = i.retailPrice

  // 各项渠道费用（基于含税售价 P）
  const platformFee = round2(p * (i.platformFeeRate / 100))
  const commission = round2(p * (i.commissionRate / 100))
  const marketing = round2(p * (i.marketingRate / 100))
  const managementFee = round2(p * ((i.managementFeeRate ?? 0) / 100))

  // 退货：退款额 + 处理费
  // applyDefaults 已保证 returnRate / returnHandlingFeeRate 有默认值，用 ?? 兜底防御
  const returnRate = i.returnRate ?? 5
  const returnHandlingFeeRate = i.returnHandlingFeeRate ?? 5
  const returnRefund = round2(p * (returnRate / 100))
  const returnHandling = round2(returnRefund * (returnHandlingFeeRate / 100))

  const channelTotal = round2(
    platformFee + commission + marketing + managementFee + returnRefund + returnHandling
  )

  return {
    platformFee,
    commission,
    returnRefund,
    returnHandling,
    marketing,
    managementFee,
    channelTotal,
  }
}
