/**
 * 预算对比计算（纯函数）
 *
 * 公式：
 *   预算差异 = 实际总成本 - 预算总额
 *   差异率 % = (实际 - 预算) / 预算 × 100
 *
 * 业务意义：
 *   - 正值表示超预算（需预警）
 *   - 负值表示节余
 *   - 无预算时不计算
 */

import type { BudgetVarianceResult, CostInput, TotalCostResult } from './types'
import { round2, round4 } from './types'

export interface CalcBudgetVarianceDeps {
  totalCost: TotalCostResult
}

/**
 * 计算预算对比
 *
 * @param input 成本输入（含 budgetTotal 可选）
 * @param deps 依赖：总成本结果
 *
 * @example
 *   calcBudgetVariance({ budgetTotal: 100 }, { totalCost: { totalCost: 110 } })
 *   // → { budgetTotal: 100, budgetVariance: 10, budgetVarianceRate: 10 }
 */
export function calcBudgetVariance(
  input: CostInput,
  deps: CalcBudgetVarianceDeps
): BudgetVarianceResult {
  const { budgetTotal } = input
  const actualTotal = deps.totalCost.totalCost

  // 无预算：返回空对象（与接口 BudgetVarianceResult 一致）
  if (budgetTotal == null || budgetTotal <= 0) {
    return {}
  }

  const budgetVariance = round2(actualTotal - budgetTotal)
  const budgetVarianceRate = round4((budgetVariance / budgetTotal) * 100)

  return {
    budgetTotal: round2(budgetTotal),
    budgetVariance,
    budgetVarianceRate,
  }
}
