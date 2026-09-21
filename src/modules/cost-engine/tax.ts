/**
 * 税费计算引擎（16 项，纯函数）
 *
 * 公式源自真实表 `辛选正大货盘-税费计算` sheet R2 行的逆向：
 *
 * 业务模型：
 *   - 含税售价 P（用户看到的售价）
 *   - 平台服务费从售价里扣除 → 实际到账 = 结算销售额(含税) = P - 平台服务费
 *   - 达人佣金从到账里付给达人
 *   - 销项税基于"不含税结算销售额"
 *   - 进项税分两类：货物类（13%）、服务类（6%）
 *   - 平台费已从售价扣过，不计入"可扣除费用总额"（避免重复扣除）
 *
 * 完整公式（编号对应真实表列顺序）：
 *   [1]  平台服务费(含税)        = P × platformFeeRate%
 *   [2]  结算销售额(含税)        = P - [1]
 *   [3]  不含税结算销售额 S      = [2] / (1 + 货物增值税率/100)
 *   [4]  销项税额                = S × 货物增值税率/100
 *   [5]  达人佣金(含税)          = [2] × 佣金率/100
 *   [6]  达人佣金进项税          = 发票类型=='达人开票' ? [5] / (1+服务税率/100) × 服务税率/100 : 0
 *   [7]  平台服务费进项税        = [1] / (1+服务税率/100) × 服务税率/100
 *   [8]  采购成本进项税          = C × 货物增值税率/100
 *   [9]  快递费进项税            = F × 服务税率/100
 *   [10] 总可抵扣进项税          = [6] + [7] + [8] + [9]
 *   [11] 应交增值税              = [4] - [10]
 *   [12] 应交附加税              = [11] × 附加税率/100
 *   [13] 可扣除费用总额          = C + F + [5]/(1+服务税率/100) + [12]
 *        （不含平台费，因为已从售价扣过）
 *   [14] 利润总额                = S - [13]
 *   [15] 应交企业所得税          = max([14], 0) × 所得税率/100
 *   [16] 净利润                  = [14] - [15]
 *   [17] 总税费                  = [11] + [12] + [15]
 *
 * Golden Test 用例（真实表 R2）：
 *   输入：P=69, C=8.0531, F=2.5, r=40, platformFeeRate=2, 发票类型=达人开票
 *   期望：S=59.84, 销项税=7.78, 净利润=22.02, 总税费=6.73
 */

import type { CostInput, TaxResult, FreightResult, ChannelCostResult, TotalCostResult } from './types'
import { round2 } from './types'
import { applyDefaults, INVOICE_PRESETS } from './presets'

export interface CalcTaxDeps {
  freight: FreightResult
  channel: ChannelCostResult
  totalCost: TotalCostResult
}

/**
 * 计算税费（16 项）
 *
 * @param input 成本输入
 * @param deps 依赖：运费 + 渠道费用 + 总成本结果
 * @returns 税费明细（16 项）
 */
export function calcTax(input: CostInput, deps: CalcTaxDeps): TaxResult {
  const i = applyDefaults(input)
  const { channel } = deps

  // 发票类型预设（决定哪些进项税可抵扣）
  const invoicePreset = INVOICE_PRESETS[i.invoiceType]

  // 输入参数
  const P = i.retailPrice                              // 含税售价
  const C = deps.totalCost.purchaseCostExclVat         // 不含税采购成本（L1+L2+L3+L6）
  const F = deps.freight.baseFreight                   // 不含税快递费（基础运费，不含冷链附加）
  const r = i.commissionRate                           // 佣金率 %
  const goodsVatRate = i.goodsVatRate!                 // 货物增值税率 %
  const serviceVatRate = i.serviceVatRate!             // 服务类进项税率 %
  const surtaxRate = i.surtaxRate!                     // 附加税率 %
  const incomeTaxRate = i.incomeTaxRate!               // 企业所得税率 %

  // [1] 平台服务费(含税) —— 来自渠道费用计算结果
  const platformFeeInclVat = round2(channel.platformFee)

  // [2] 结算销售额(含税) = P - 平台服务费
  const settlementInclVat = round2(P - platformFeeInclVat)

  // [3] 不含税结算销售额
  const settlementSalesExclVat = round2(settlementInclVat / (1 + goodsVatRate / 100))

  // [4] 销项税额
  const outputVat = round2(settlementSalesExclVat * (goodsVatRate / 100))

  // [5] 达人佣金(含税) = 结算销售额 × 佣金率
  const commissionInclVat = round2(settlementInclVat * (r / 100))

  // [6] 达人佣金进项税（按发票类型决定是否可抵扣，按服务类税率 6%）
  const commissionInputVat = invoicePreset.commissionDeductible
    ? round2(commissionInclVat / (1 + serviceVatRate / 100) * (serviceVatRate / 100))
    : 0

  // [7] 平台服务费进项税（按发票类型决定是否可抵扣）
  const platformFeeInputVat = invoicePreset.platformFeeDeductible
    ? round2(platformFeeInclVat / (1 + serviceVatRate / 100) * (serviceVatRate / 100))
    : 0

  // [8] 采购成本进项税（按发票类型决定是否可抵扣，按货物类税率 13%）
  const purchaseInputVat = invoicePreset.purchaseDeductible
    ? round2(C * (goodsVatRate / 100))
    : 0

  // [9] 快递费进项税（按发票类型决定是否可抵扣，按服务类税率 6%）
  const freightInputVat = invoicePreset.freightDeductible
    ? round2(F * (serviceVatRate / 100))
    : 0

  // [10] 总可抵扣进项税
  const totalDeductibleInputVat = round2(
    commissionInputVat + platformFeeInputVat + purchaseInputVat + freightInputVat
  )

  // [11] 应交增值税
  const payableVat = round2(outputVat - totalDeductibleInputVat)

  // [12] 应交附加税
  const payableSurtax = round2(payableVat * (surtaxRate / 100))

  // [13] 可扣除费用总额 = 采购成本 + 快递费 + 佣金(不含税) + 应交附加税
  // 注意：不含平台费（已从售价扣过）、不含退货/推广/管理费（这些在渠道费用里单独计算）
  const commissionExclVat = round2(commissionInclVat / (1 + serviceVatRate / 100))
  const totalDeductibleExpense = round2(C + F + commissionExclVat + payableSurtax)

  // [14] 利润总额
  const totalProfit = round2(settlementSalesExclVat - totalDeductibleExpense)

  // [15] 应交企业所得税（亏损不交）
  const payableIncomeTax = round2(Math.max(totalProfit, 0) * (incomeTaxRate / 100))

  // [16] 净利润
  const netProfit = round2(totalProfit - payableIncomeTax)

  // [17] 总税费
  const totalTax = round2(payableVat + payableSurtax + payableIncomeTax)

  return {
    settlementSalesExclVat,
    outputVat,
    purchaseInputVat,
    freightInputVat,
    commissionInclVat,
    commissionInputVat,
    platformFeeInclVat,
    platformFeeInputVat,
    totalDeductibleInputVat,
    payableVat,
    payableSurtax,
    totalDeductibleExpense,
    totalProfit,
    payableIncomeTax,
    netProfit,
    totalTax,
  }
}
