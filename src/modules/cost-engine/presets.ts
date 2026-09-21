/**
 * 渠道预设与默认值
 *
 * 默认值来源：
 * - 非冷链运费 4 元：用户指示（"不涉及到冷链的运费默认按4块算"）
 * - 渠道佣金率/平台费率：AutoTM `SimplifiedCalculator.vue` channelDefaults
 * - 退货率：AutoTM + 真实表 4（远方好物 2%）
 * - 税率：真实表 3 `税费计算` sheet 表头
 */

import type { Channel, CostInput, ExpressType, InvoiceType, PricingStrategy } from './types'

// ── 运费默认值 ────────────────────────────────────────

/** 非冷链默认运费（元）—— 用户明确指示 */
export const DEFAULT_FREIGHT_BASE = 4

/** 冷链附加默认值（水冰 + 干冰 + 保温袋），源自真实表 `运费测算` sheet */
export const DEFAULT_COLD_CHAIN_EXTRA = 1.5

// ── 快递类型预设 ──────────────────────────────────────

export interface ExpressPreset {
  /** 中文名 */
  label: string
  /** 默认运费（元/件） */
  defaultFreight: number
  /** 是否冷链 */
  isColdChain: boolean
  /** 说明 */
  description: string
}

/**
 * 快递类型预设
 *
 * 用户指示："几乎是非冷链快递，可以预留冷链或者顺丰快递，如果是高端产品需要贵一些的快递；单独设置就行"
 *
 * - STANDARD：普通快递（默认 4 元，绝大多数非冷链产品）
 * - COLD_CHAIN：冷链（4 + 1.5 = 5.5 元，含干冰/水冰/保温袋）
 * - SF_EXPRESS：顺丰（默认 8 元，时效优先）
 * - PREMIUM：高端快递（默认 15 元，礼盒/高客单价产品保价）
 */
export const EXPRESS_PRESETS: Record<ExpressType, ExpressPreset> = {
  STANDARD: {
    label: '普通快递',
    defaultFreight: 4,
    isColdChain: false,
    description: '四通一达，绝大多数非冷链产品',
  },
  COLD_CHAIN: {
    label: '冷链',
    defaultFreight: 5.5,
    isColdChain: true,
    description: '含干冰/水冰/保温袋附加',
  },
  SF_EXPRESS: {
    label: '顺丰',
    defaultFreight: 8,
    isColdChain: false,
    description: '时效优先，高客单价可选',
  },
  PREMIUM: {
    label: '高端快递',
    defaultFreight: 15,
    isColdChain: false,
    description: '礼盒/高客单价产品保价',
  },
}

/** 默认快递类型 */
export const DEFAULT_EXPRESS_TYPE: ExpressType = 'STANDARD'

// ── 税率默认值（%） ─────────────────────────────────

/** 货物增值税率（源自真实表 3） */
export const DEFAULT_GOODS_VAT_RATE = 13

/** 服务类进项税率（达人佣金/快递费/平台费，源自真实表 3） */
export const DEFAULT_SERVICE_VAT_RATE = 6

/** 附加税率（城建税+教育附加，源自真实表 3） */
export const DEFAULT_SURTAX_RATE = 12

/** 企业所得税率（源自真实表 3） */
export const DEFAULT_INCOME_TAX_RATE = 5

// ── 其他默认值 ────────────────────────────────────────

/** 默认损耗率 % */
export const DEFAULT_LOSS_RATE = 3

/** 默认退货率 % */
export const DEFAULT_RETURN_RATE = 5

/** 默认退货处理费率 % */
export const DEFAULT_RETURN_HANDLING_FEE_RATE = 5

/** 默认目标利润率 % */
export const DEFAULT_TARGET_MARGIN_RATE = 30

/** 默认定价策略 */
export const DEFAULT_PRICING_STRATEGY: PricingStrategy = 'MARKET_FOLLOW'

/** 默认发票类型 */
export const DEFAULT_INVOICE_TYPE: InvoiceType = '达人开票'

// ── 发票类型预设 ──────────────────────────────────────

export interface InvoicePreset {
  /** 中文标签 */
  label: string
  /**
   * 开票费率 %（开票方承担的税点成本，平台/达人开票时按此税率开票）
   * - 达人开票：6%（现代服务）
   * - 团长：6%（经纪代理服务）
   * - AB账：0%（未开票）
   * - 无发票：0%（无任何发票）
   */
  invoiceFeeRate: number
  /** 佣金进项税是否可抵扣 */
  commissionDeductible: boolean
  /** 平台费进项税是否可抵扣 */
  platformFeeDeductible: boolean
  /** 采购成本进项税是否可抵扣 */
  purchaseDeductible: boolean
  /** 快递费进项税是否可抵扣 */
  freightDeductible: boolean
  /** 说明 */
  description: string
}

/**
 * 发票类型预设
 *
 * | 类型     | 开票费率 | 佣金抵扣 | 平台费抵扣 | 采购抵扣 | 快递抵扣 |
 * |----------|----------|----------|------------|----------|----------|
 * | 达人开票 | 6%       | ✓        | ✓          | ✓        | ✓        |
 * | 团长     | 6%       | ✓        | ✓          | ✓        | ✓        |
 * | AB账     | 0%       | ✗        | ✓          | ✓        | ✓        |
 * | 无发票   | 0%       | ✗        | ✗          | ✗        | ✗        |
 *
 * 注：AB账 指达人不开票，但平台/采购/快递仍可取得发票抵扣；
 *     无发票 指整个交易链路都没票，所有进项均不可抵扣。
 */
export const INVOICE_PRESETS: Record<InvoiceType, InvoicePreset> = {
  '达人开票': {
    label: '达人开票',
    invoiceFeeRate: 6,
    commissionDeductible: true,
    platformFeeDeductible: true,
    purchaseDeductible: true,
    freightDeductible: true,
    description: '达人给平台开 6% 服务类发票，佣金可抵扣进项',
  },
  '团长': {
    label: '团长开票',
    invoiceFeeRate: 6,
    commissionDeductible: true,
    platformFeeDeductible: true,
    purchaseDeductible: true,
    freightDeductible: true,
    description: '团长按经纪代理服务 6% 开票，佣金可抵扣',
  },
  'AB账': {
    label: 'AB账（达人不开票）',
    invoiceFeeRate: 0,
    commissionDeductible: false,
    platformFeeDeductible: true,
    purchaseDeductible: true,
    freightDeductible: true,
    description: '达人未开票，佣金不可抵扣；平台/采购/快递可抵扣',
  },
  '无发票': {
    label: '无发票',
    invoiceFeeRate: 0,
    commissionDeductible: false,
    platformFeeDeductible: false,
    purchaseDeductible: false,
    freightDeductible: false,
    description: '全链路无票，所有进项税均不可抵扣（成本最高）',
  },
}

// ── 渠道预设 ──────────────────────────────────────────

export interface ChannelPreset {
  /** 渠道中文名 */
  label: string
  /** 默认佣金率 % */
  commissionRate: number
  /** 默认平台服务费率 % */
  platformFeeRate: number
  /** 默认推广费率 % */
  marketingRate: number
  /** 默认退货率 % */
  returnRate: number
  /** 渠道说明 */
  description: string
  /**
   * 渠道模式：决定哪些费用字段适用
   * - LIVE：直播带货模式，全部费用适用（平台费/佣金/推广/管理费/退货/退货处理）
   * - SUPPLY：直接供货模式，仅可能含佣金（团长），无平台费/推广/管理费
   * - OEM：纯代工，无任何渠道费用
   */
  mode: 'LIVE' | 'SUPPLY' | 'OEM'
  /** 是否涉及平台服务费（仅 LIVE 模式） */
  hasPlatformFee: boolean
  /** 是否涉及达人佣金 */
  hasCommission: boolean
  /** 是否涉及推广/营销费用（仅 LIVE 模式） */
  hasMarketing: boolean
  /** 是否涉及管理费用 */
  hasManagementFee: boolean
  /** 是否涉及退货（直播/电商场景） */
  hasReturn: boolean
}

/**
 * 五大渠道预设值
 *
 * 来源：AutoTM `SimplifiedCalculator.vue` + 真实表 4
 * - PUBLIC（公域）：抖音/快手直播，佣金 20%，平台 2%
 * - PRIVATE（私域）：私域社群/集采/代发，佣金 10%，平台 1%
 * - XINXUAN（辛选）：辛巴团队，佣金 25%，平台 3%
 * - YUANFANG（远方好物）：平台利润空间由售价-供货价得出，无佣金无平台费
 * - OEM：纯代工，无渠道费用
 */
export const CHANNEL_PRESETS: Record<Channel, ChannelPreset> = {
  PUBLIC: {
    label: '公域',
    commissionRate: 20,
    platformFeeRate: 2,
    marketingRate: 8,
    returnRate: 5,
    description: '抖音/快手直播',
    mode: 'LIVE',
    hasPlatformFee: true,
    hasCommission: true,
    hasMarketing: true,
    hasManagementFee: true,
    hasReturn: true,
  },
  PRIVATE: {
    label: '私域',
    commissionRate: 10,
    platformFeeRate: 0,
    marketingRate: 0,
    returnRate: 3,
    description: '私域社群/集采/代发（直接供货，无平台费/推广费）',
    mode: 'SUPPLY',
    hasPlatformFee: false,
    hasCommission: true,
    hasMarketing: false,
    hasManagementFee: false,
    hasReturn: true,
  },
  XINXUAN: {
    label: '辛选',
    commissionRate: 25,
    platformFeeRate: 3,
    marketingRate: 10,
    returnRate: 5,
    description: '辛巴团队直播',
    mode: 'LIVE',
    hasPlatformFee: true,
    hasCommission: true,
    hasMarketing: true,
    hasManagementFee: true,
    hasReturn: true,
  },
  YUANFANG: {
    label: '远方好物',
    commissionRate: 0,
    platformFeeRate: 0,
    marketingRate: 0,
    returnRate: 2,
    description: '平台利润空间 = 售价 - 供货价（直接供货，无营销费用）',
    mode: 'SUPPLY',
    hasPlatformFee: false,
    hasCommission: false,
    hasMarketing: false,
    hasManagementFee: false,
    hasReturn: true,
  },
  OEM: {
    label: 'OEM 代工',
    commissionRate: 0,
    platformFeeRate: 0,
    marketingRate: 0,
    returnRate: 0,
    description: '纯代工，无任何渠道费用',
    mode: 'OEM',
    hasPlatformFee: false,
    hasCommission: false,
    hasMarketing: false,
    hasManagementFee: false,
    hasReturn: false,
  },
}

/**
 * 按品类预设的目标利润率 %
 * - 保健品：35%（高毛利品类）
 * - 食品：25%（低毛利走量）
 * - 礼盒：40%（礼品溢价）
 * - 默认：30%
 */
export const CATEGORY_TARGET_MARGIN: Record<string, number> = {
  '保健品': 35,
  '保健食品': 35,
  '食品': 25,
  '功能性食品': 30,
  '营养食品': 30,
  '礼盒': 40,
  '默认': 30,
}

/**
 * 应用渠道预设到输入：缺失字段填渠道默认值
 * 已显式传入的字段不会被覆盖。
 */
export function applyChannelPreset(input: CostInput): CostInput {
  const preset = CHANNEL_PRESETS[input.channel]
  if (!preset) return input

  return {
    ...input,
    commissionRate: input.commissionRate ?? preset.commissionRate,
    platformFeeRate: input.platformFeeRate ?? preset.platformFeeRate,
    marketingRate: input.marketingRate ?? preset.marketingRate,
    returnRate: input.returnRate ?? preset.returnRate,
  }
}

/**
 * 应用所有默认值：把 undefined 字段填上系统默认值
 * 用于计算前确保所有字段都有值。
 *
 * 快递类型逻辑：
 * - 若未传 expressType 但传了 isColdChain=true，自动判定为 COLD_CHAIN（向后兼容）
 * - 若未传 expressType 也未传 isColdChain，使用 DEFAULT_EXPRESS_TYPE
 * - 若未传 freightBase，按 expressType 预设的 defaultFreight 填充
 */
export function applyDefaults(input: CostInput): CostInput {
  const withChannel = applyChannelPreset(input)

  // 1. 推导 expressType（向后兼容 isColdChain）
  let expressType = withChannel.expressType
  if (!expressType) {
    expressType = withChannel.isColdChain ? 'COLD_CHAIN' : DEFAULT_EXPRESS_TYPE
  }
  const expressPreset = EXPRESS_PRESETS[expressType]

  // 2. 推导 isColdChain（expressType 优先于原值）
  const isColdChain = expressType === 'COLD_CHAIN' || withChannel.isColdChain === true

  // 3. 若未显式传 freightBase，按 expressType 预设填充
  //    - COLD_CHAIN：预设 5.5（已含 4 + 1.5 附加），拆分为 base=4 + coldExtra=1.5
  //    - SF_EXPRESS/PREMIUM：预设即 base，无冷链附加
  //    - STANDARD：默认 4
  let freightBase = withChannel.freightBase
  let freightColdChain = withChannel.freightColdChain
  if (freightBase == null) {
    if (expressType === 'COLD_CHAIN') {
      freightBase = DEFAULT_FREIGHT_BASE
      freightColdChain = freightColdChain ?? DEFAULT_COLD_CHAIN_EXTRA
    } else {
      freightBase = expressPreset.defaultFreight
    }
  }

  return {
    ...withChannel,
    expressType,
    // 运费
    freightBase,
    freightContinue: withChannel.freightContinue ?? 0,
    freightColdChain: freightColdChain ?? (isColdChain ? DEFAULT_COLD_CHAIN_EXTRA : 0),
    isColdChain,
    // 包装/制造
    innerPackagingCost: withChannel.innerPackagingCost ?? 0,
    lossRate: withChannel.lossRate ?? DEFAULT_LOSS_RATE,
    storageCost: withChannel.storageCost ?? 0,
    // 渠道
    returnRate: withChannel.returnRate ?? DEFAULT_RETURN_RATE,
    returnHandlingFeeRate: withChannel.returnHandlingFeeRate ?? DEFAULT_RETURN_HANDLING_FEE_RATE,
    managementFeeRate: withChannel.managementFeeRate ?? 0,
    // 税率
    goodsVatRate: withChannel.goodsVatRate ?? DEFAULT_GOODS_VAT_RATE,
    serviceVatRate: withChannel.serviceVatRate ?? DEFAULT_SERVICE_VAT_RATE,
    surtaxRate: withChannel.surtaxRate ?? DEFAULT_SURTAX_RATE,
    incomeTaxRate: withChannel.incomeTaxRate ?? DEFAULT_INCOME_TAX_RATE,
    // 定价
    targetMarginRate: withChannel.targetMarginRate ?? DEFAULT_TARGET_MARGIN_RATE,
    pricingStrategy: withChannel.pricingStrategy ?? DEFAULT_PRICING_STRATEGY,
    invoiceType: withChannel.invoiceType ?? DEFAULT_INVOICE_TYPE,
  }
}
