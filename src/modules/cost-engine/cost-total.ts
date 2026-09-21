/**
 * 总成本计算（纯函数）
 *
 * 成本结构（统一术语）：
 *   L1 直接材料   = 原料成本 × (1 + 损耗率/100)
 *   L2 包装       = 外包 + 内包
 *   L3 制造       = 制造费 + 认证费
 *   L4 物流仓储   = 运费合计 + 仓储费
 *   L5 渠道费用   = 平台费 + 佣金 + 退货 + 推广 + 管理费
 *   L6 月固定成本 = 团队工资/房租等（仅用于盈亏平衡分析，不计入单品成本）
 *
 * 汇总：
 *   totalBomCost     = L1 + L2 + L3 + L4
 *   totalChannelCost = L5
 *   totalCost        = L1 + L2 + L3 + L4 + L5（不含 L6，单品成本只算直接相关）
 *
 * 用于税费计算的中间值：
 *   purchaseCostExclVat = L1 + L2 + L3（不含 L6，月固定成本不是采购进项）
 *   注：L4 运费和 L5 渠道费用单独走服务类进项税抵扣
 *
 * 设计变更（2026-07-28）：
 *   月固定成本（团队工资、房租等）不应摊到单品成本中——
 *   一个产品利润几十块，摊几万团队成本不合理，且无销量无法合理摊派。
 *   L6 改为仅用于「盈亏平衡分析」（breakevenUnits = monthlyFixed / 单件边际贡献）。
 */

import type { CostInput, TotalCostResult, FreightResult, ChannelCostResult } from './types'
import { round2 } from './types'
import { applyDefaults } from './presets'
import { calcFreight } from './freight'
import { calcChannelCost } from './channel'

export interface CalcTotalCostInput {
  freight: FreightResult
  channel: ChannelCostResult
}

/**
 * 计算总成本
 *
 * @param input 成本输入
 * @param deps 依赖：运费 + 渠道费用结果（避免重复计算）
 *
 * @example
 *   const freight = calcFreight(input)
 *   const channel = calcChannelCost(input)
 *   const total = calcTotalCost(input, { freight, channel })
 */
export function calcTotalCost(
  input: CostInput,
  deps: CalcTotalCostInput
): TotalCostResult {
  const i = applyDefaults(input)
  const { freight, channel } = deps

  // L1 直接材料（含损耗）
  const materialWithLoss = i.materialCost * (1 + (i.lossRate ?? 0) / 100)
  const layer1Material = round2(materialWithLoss)

  // L2 包装
  const layer2Packaging = round2(i.packagingCost + (i.innerPackagingCost ?? 0))

  // L3 制造
  const layer3Manufacturing = round2(i.manufacturingCost + i.certificationCost)

  // L4 物流仓储
  const layer4Freight = round2(freight.freightTotal + (i.storageCost ?? 0))

  // L5 渠道费用
  const layer5Channel = round2(channel.channelTotal)

  // L6 月固定成本（仅用于盈亏平衡分析，不计入单品成本）
  const layer6Allocation = round2(i.monthlyFixed)

  // 汇总（totalCost 不含 L6）
  const totalBomCost = round2(
    layer1Material + layer2Packaging + layer3Manufacturing + layer4Freight
  )
  const totalChannelCost = layer5Channel
  const totalCost = round2(
    layer1Material + layer2Packaging + layer3Manufacturing + layer4Freight +
    layer5Channel
  )

  // 用于税费计算的中间值：不含税采购成本（L1+L2+L3，不含 L6）
  // 月固定成本（工资/房租）不是采购进项，不能抵扣增值税
  // L4 运费和 L5 渠道费用单独走服务类进项税抵扣
  const purchaseCostExclVat = round2(
    layer1Material + layer2Packaging + layer3Manufacturing
  )

  return {
    layer1Material,
    layer2Packaging,
    layer3Manufacturing,
    layer4Freight,
    layer5Channel,
    layer6Allocation,
    totalBomCost,
    totalChannelCost,
    totalCost,
    purchaseCostExclVat,
  }
}
