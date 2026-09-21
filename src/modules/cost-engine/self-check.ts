/**
 * 自检规则（AI 辅助提示，不参与计算）
 *
 * 设计原则：
 *   - AI 只输出提示信息，不修改任何数值
 *   - 规则基于业务红线（BOM 毛利率 65%、净利率 20% 等）
 *   - 提示分两类：WARN（警告）、ERROR（错误，需立即核实）
 *
 * 规则来源：
 *   - 现有 `src/lib/bom.ts` calcBom alerts（BOM 毛利率 65%、净利率 20%、佣金 25%、退货 8%）
 *   - 真实表 3 运费测算（冷链运费偏低检查）
 *   - 用户指示（市场参考价 90 天过期）
 */

import type { CostInput, CostResult, CostAlert } from './types'
import { round2, round4 } from './types'

export interface SelfCheckContext {
  /** 计算结果（用于规则判断） */
  result: CostResult
  /** 原始输入（用于规则判断） */
  input: CostInput
  /** 当前日期（用于过期检查，默认 now） */
  now?: Date
}

/** 计算两个日期相差天数 */
function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * 运行所有自检规则，返回告警列表
 *
 * @param ctx 上下文：输入 + 计算结果
 * @returns 告警数组（可能为空）
 */
export function runSelfCheck(ctx: SelfCheckContext): CostAlert[] {
  const alerts: CostAlert[] = []
  const { input, result, now = new Date() } = ctx

  // ── ERROR 级：可能导致亏本或数据错误 ──

  // 1. 净利率为负（亏本）
  if (result.netMarginRate < 0) {
    alerts.push({
      id: 'net-loss',
      msg: `净利率 ${result.netMarginRate.toFixed(1)}% 为负，每卖一件亏 ${Math.abs(result.netProfit).toFixed(2)} 元`,
      severity: 'ERROR',
    })
  }

  // 2. 最终报价低于保底价（已被 clamp，但提示用户）
  if (input.finalSupplyPrice != null && input.finalSupplyPrice < result.supplyPriceFloor) {
    alerts.push({
      id: 'supply-below-floor',
      msg: `最终报价 ${input.finalSupplyPrice} 低于保底价 ${result.supplyPriceFloor}，已自动上调至保底价`,
      severity: 'ERROR',
    })
  }

  // 3. 冷链运费偏低（低于预设 5.5，可能漏算干冰/水冰）
  //    注：COLD_CHAIN 预设 freightTotal=5.5，<5.5 说明用户漏配冷链附加
  if (input.isColdChain && result.layer4Freight < 5.5) {
    alerts.push({
      id: 'freight-cold-mismatch',
      msg: `冷链运费 ${result.layer4Freight} 元偏低（预设 5.5），请确认是否漏算干冰/水冰/保温袋`,
      severity: 'ERROR',
    })
  }

  // 3.1 普通快递运费偏高（>10 元，可能误配为 STANDARD）
  if (input.expressType === 'STANDARD' && result.layer4Freight > 10) {
    alerts.push({
      id: 'freight-standard-too-high',
      msg: `普通快递运费 ${result.layer4Freight} 元偏高，建议改用顺丰或高端快递类型`,
      severity: 'WARN',
    })
  }

  // 3.2 高端产品用了低端快递（售价>200 但选 STANDARD）
  if (input.retailPrice > 200 && input.expressType === 'STANDARD') {
    alerts.push({
      id: 'freight-mismatch-premium',
      msg: `售价 ${input.retailPrice} 元较高，建议改用顺丰或高端快递以提升开箱体验`,
      severity: 'WARN',
    })
  }

  // ── WARN 级：未达红线或异常 ──

  // 4. 净利率低于 20%（红线）
  if (result.netMarginRate >= 0 && result.netMarginRate < 20) {
    alerts.push({
      id: 'margin-too-low',
      msg: `净利率 ${result.netMarginRate.toFixed(1)}% 未达 20% 红线`,
      severity: 'WARN',
    })
  }

  // 5. BOM 毛利率低于 65%（红线）
  if (result.bomMarginRate < 65) {
    alerts.push({
      id: 'bom-margin-low',
      msg: `BOM 毛利率 ${result.bomMarginRate.toFixed(1)}% 未达 65% 红线`,
      severity: 'WARN',
    })
  }

  // 6. 佣金率超 30%
  if (input.commissionRate > 30) {
    alerts.push({
      id: 'commission-abnormal',
      msg: `达人佣金率 ${input.commissionRate}% 超 30%，压缩净利空间`,
      severity: 'WARN',
    })
  }

  // 7. 退货率超 8%
  const returnRate = input.returnRate ?? 5
  if (returnRate > 8) {
    alerts.push({
      id: 'return-rate-high',
      msg: `退货率 ${returnRate}% 偏高，建议分析原因`,
      severity: 'WARN',
    })
  }

  // 8. 市场参考价过期（90 天）
  if (input.marketPriceDate) {
    const d = typeof input.marketPriceDate === 'string'
      ? new Date(input.marketPriceDate)
      : input.marketPriceDate
    if (!isNaN(d.getTime())) {
      const days = daysBetween(now, d)
      if (days > 90) {
        alerts.push({
          id: 'market-price-expired',
          msg: `市场参考价已 ${days} 天未更新（超 90 天），建议重新采集`,
          severity: 'WARN',
        })
      }
    }
  }

  // 9. 实际成本超预算 10%
  if (input.budgetTotal != null && input.budgetTotal > 0) {
    const varianceRate = round4((result.totalCost - input.budgetTotal) / input.budgetTotal * 100)
    if (varianceRate > 10) {
      alerts.push({
        id: 'budget-overrun',
        msg: `实际成本 ${result.totalCost} 超预算 ${varianceRate.toFixed(1)}%（预算 ${input.budgetTotal}）`,
        severity: 'WARN',
      })
    }
  }

  // 10. 售价为 0 或负
  if (input.retailPrice <= 0) {
    alerts.push({
      id: 'invalid-price',
      msg: '售价为 0 或负，请核实',
      severity: 'ERROR',
    })
  }

  // 11. 月固定成本提示（INFO：仅用于盈亏平衡分析，不计入单品成本）
  if (input.monthlyFixed > 0) {
    alerts.push({
      id: 'monthly-fixed-info',
      msg: `月固定成本 ${input.monthlyFixed} 元仅用于盈亏平衡分析（盈亏平衡量 ${result.breakevenUnits} 件），不计入单品成本`,
      severity: 'INFO',
    })
  }

  return alerts
}

/** 便捷方法：直接传入 input + result，返回告警 */
export function checkCost(input: CostInput, result: CostResult): CostAlert[] {
  return runSelfCheck({ input, result })
}
