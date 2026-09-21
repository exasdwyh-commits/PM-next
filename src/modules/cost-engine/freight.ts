/**
 * 运费计算（纯函数）
 *
 * 公式源自真实表 `辛选正大货盘-运费测算` sheet：
 *   非冷链运费 = 首重快递费 + 续重 × (重量-1) + 箱子 + 人工
 *   冷链运费   = 非冷链运费 + 水冰 + 干冰 + 保温袋
 *
 * 用户指示："几乎是非冷链快递，可以预留冷链或者顺丰快递，如果是高端产品需要贵一些的快递；单独设置就行"
 *
 * 快递类型预设（在 applyDefaults 中已处理）：
 *   - STANDARD    普通快递  默认 4 元
 *   - COLD_CHAIN  冷链      默认 5.5 元（= 4 基础 + 1.5 冷链附加）
 *   - SF_EXPRESS  顺丰      默认 8 元
 *   - PREMIUM     高端快递  默认 15 元
 *
 * 显式传入 freightBase/freightColdChain 会覆盖预设。
 */

import type { CostInput, FreightResult } from './types'
import { round2 } from './types'
import { applyDefaults, DEFAULT_FREIGHT_BASE, DEFAULT_COLD_CHAIN_EXTRA } from './presets'

/**
 * 计算运费
 *
 * @param input 成本输入（会用 applyDefaults 补默认值，含 expressType 派生）
 * @returns 运费明细 + 合计
 *
 * @example
 *   calcFreight({ })                                    // → STANDARD: { baseFreight: 4, coldChainExtra: 0, freightTotal: 4 }
 *   calcFreight({ expressType: 'COLD_CHAIN' })          // → { baseFreight: 4, coldChainExtra: 1.5, freightTotal: 5.5 }
 *   calcFreight({ expressType: 'SF_EXPRESS' })          // → { baseFreight: 8, coldChainExtra: 0, freightTotal: 8 }
 *   calcFreight({ expressType: 'PREMIUM' })             // → { baseFreight: 15, coldChainExtra: 0, freightTotal: 15 }
 *   calcFreight({ expressType: 'SF_EXPRESS', freightBase: 12 })  // → 自定义覆盖：{ baseFreight: 12, ... }
 */
export function calcFreight(input: CostInput): FreightResult {
  const i = applyDefaults(input)

  // 非冷链基础运费：applyDefaults 已根据 expressType 填好 freightBase
  // 已包含首重 + 续重 + 箱子 + 人工，无需额外拆分
  const baseFreight = round2(
    (i.freightBase ?? DEFAULT_FREIGHT_BASE) + (i.freightContinue ?? 0)
  )

  // 冷链附加：水冰 + 干冰 + 保温袋（默认 1.5 元，仅在 isColdChain=true 时计入）
  const coldChainExtra = i.isColdChain
    ? round2(i.freightColdChain ?? DEFAULT_COLD_CHAIN_EXTRA)
    : 0

  const freightTotal = round2(baseFreight + coldChainExtra)

  return { baseFreight, coldChainExtra, freightTotal }
}
