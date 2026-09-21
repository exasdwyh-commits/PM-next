/**
 * 运营成本核算与供货定价模块 — 类型定义
 *
 * 设计原则：机械化计算，AI 不参与数值，仅辅助自检提示。
 * 所有公式源自真实业务表逆向（见 docs/OPERATIONS_COST_MODULE.md §2）。
 */

// ── 枚举类型 ──────────────────────────────────────────

/** 销售渠道 */
export type Channel = 'PUBLIC' | 'PRIVATE' | 'XINXUAN' | 'YUANFANG' | 'OEM'

/**
 * 发票类型（影响进项税抵扣）
 * - 达人开票：达人给平台开 6% 服务类发票，佣金可抵扣
 * - 团长：团长开票，佣金按服务类 6% 抵扣（部分平台按货物 13%）
 * - AB账：达人不开票，佣金不可抵扣（隐性成本）
 * - 无发票：所有进项均不可抵扣（采购/快递/平台费/佣金全部不抵扣）
 */
export type InvoiceType = '达人开票' | '团长' | 'AB账' | '无发票'

/** 定价策略 */
export type PricingStrategy = 'CONSERVATIVE' | 'MARKET_FOLLOW' | 'AGGRESSIVE'

/**
 * 快递类型
 * - STANDARD：普通快递（默认 4 元，绝大多数非冷链产品）
 * - COLD_CHAIN：冷链（普通 + 干冰/水冰/保温袋附加，默认 5.5 元）
 * - SF_EXPRESS：顺丰（默认 8 元，时效优先）
 * - PREMIUM：高端快递（默认 15 元，礼盒/高客单价产品）
 */
export type ExpressType = 'STANDARD' | 'COLD_CHAIN' | 'SF_EXPRESS' | 'PREMIUM'

/** 成本记录状态 */
export type CostStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

/** 运营角色（权限矩阵） */
export type OperationsRole =
  | 'OPERATIONS_VIEWER'
  | 'OPERATIONS_ANALYST'
  | 'OPERATIONS_MANAGER'
  | 'OPERATIONS_ADMIN'

/** 预算来源 */
export type BudgetSource = 'FINANCE' | 'PM' | 'HISTORICAL'

// ── 输入 ──────────────────────────────────────────────

/** 成本计算输入（对应 CostRecord 表的核心字段） */
export interface CostInput {
  // ── L1 直接材料 ──
  materialCost: number
  ingredientCount?: number

  // ── L2 包装 ──
  packagingCost: number
  innerPackagingCost?: number

  // ── L3 制造 ──
  manufacturingCost: number
  certificationCost: number
  /** 损耗率 %（默认 3） */
  lossRate?: number

  // ── L4 物流仓储 ──
  /**
   * 快递类型（用户单独设置，决定运费默认值）
   * - 不传或 STANDARD：普通快递 4 元
   * - COLD_CHAIN：冷链 5.5 元
   * - SF_EXPRESS：顺丰 8 元
   * - PREMIUM：高端快递 15 元
   * 显式传入 freightBase 会覆盖预设。
   */
  expressType?: ExpressType
  /** 是否冷链（向后兼容，等价于 expressType === 'COLD_CHAIN'） */
  isColdChain?: boolean
  /** 非冷链基础运费（默认 4 元，用户指示） */
  freightBase?: number
  /** 续重费（按重量计） */
  freightContinue?: number
  /** 冷链附加费（水冰+干冰+保温袋） */
  freightColdChain?: number
  storageCost?: number

  // ── L5 渠道费用 ──
  /** 平台服务费率 % */
  platformFeeRate: number
  /** 达人佣金率 % */
  commissionRate: number
  /** 退货率 %（默认 5） */
  returnRate?: number
  /** 退货处理费率 %（默认 5） */
  returnHandlingFeeRate?: number
  /** 推广费率 % */
  marketingRate: number
  /** 管理费用率 %（来自表 1） */
  managementFeeRate?: number

  // ── L6 分摊 ──
  /** 月固定成本（用于盈亏平衡量） */
  monthlyFixed: number

  // ── 税率 % ──
  /** 货物增值税率（默认 13） */
  goodsVatRate?: number
  /** 服务类进项税率（默认 6） */
  serviceVatRate?: number
  /** 附加税率（默认 12） */
  surtaxRate?: number
  /** 企业所得税率（默认 5） */
  incomeTaxRate?: number

  // ── 售价 ──
  /** 含税零售价 */
  retailPrice: number

  // ── 渠道 & 发票 ──
  channel: Channel
  invoiceType: InvoiceType
  /** 组合售卖类型：1BOX | 2BOX | 3BOX | 4BOX | REGULAR+TRIAL */
  bundleType?: string

  // ── 市场锚定 ──
  /** 市场参考价（零售价，如 GABA 200） */
  marketReferencePrice?: number
  /** 市场价采集日期（用于过期检查） */
  marketPriceDate?: Date | string | null

  // ── 定价 ──
  /** 目标利润率 %（默认 30） */
  targetMarginRate?: number
  pricingStrategy?: PricingStrategy
  /** 成本优势度 0-100 */
  costAdvantageScore?: number
  /** 人工调整后的最终报价 */
  finalSupplyPrice?: number

  // ── 预算 ──
  budgetTotal?: number
}

// ── 输出 ──────────────────────────────────────────────

/** 运费计算结果 */
export interface FreightResult {
  /** 非冷链基础运费（首重+续重+箱子+人工） */
  baseFreight: number
  /** 冷链附加（水冰+干冰+保温袋） */
  coldChainExtra: number
  /** 运费合计 */
  freightTotal: number
}

/** 渠道费用计算结果 */
export interface ChannelCostResult {
  /** 平台服务费（含税） */
  platformFee: number
  /** 达人佣金（含税） */
  commission: number
  /** 退货退款额 */
  returnRefund: number
  /** 退货处理费 */
  returnHandling: number
  /** 推广费 */
  marketing: number
  /** 管理费用 */
  managementFee: number
  /** 渠道费用合计 */
  channelTotal: number
}

/** 总成本计算结果（六层结构） */
export interface TotalCostResult {
  // 六层成本
  layer1Material: number
  layer2Packaging: number
  layer3Manufacturing: number
  layer4Freight: number
  layer5Channel: number
  layer6Allocation: number

  // 汇总
  /** BOM 成本（L1+L2+L3+L4，含损耗） */
  totalBomCost: number
  /** 渠道成本合计（L5） */
  totalChannelCost: number
  /** 总成本（L1+L2+L3+L4+L5，不含税，不含 L6 月固定成本） */
  totalCost: number

  // 用于税费计算的中间值
  /** 不含税采购成本（L1+L2+L3，可抵扣货物增值税进项；不含 L6 月固定成本） */
  purchaseCostExclVat: number
}

/** 税费计算结果（16 项，源自真实表 3） */
export interface TaxResult {
  /** [1] 不含税结算销售额 = P / (1 + 货物增值税率) */
  settlementSalesExclVat: number
  /** [2] 销项税额 */
  outputVat: number
  /** [3] 采购成本进项税 */
  purchaseInputVat: number
  /** [4] 快递费进项税 */
  freightInputVat: number
  /** [5] 达人佣金(含税) */
  commissionInclVat: number
  /** [6] 达人佣金进项税（仅"达人开票"可抵扣） */
  commissionInputVat: number
  /** [7] 平台服务费(含税) */
  platformFeeInclVat: number
  /** [8] 平台服务费进项税 */
  platformFeeInputVat: number
  /** [9] 总可抵扣进项税 = [3]+[4]+[6]+[8] */
  totalDeductibleInputVat: number
  /** [10] 应交增值税 = [2] - [9] */
  payableVat: number
  /** [11] 应交附加税 = [10] × 附加税率 */
  payableSurtax: number
  /** [12] 可扣除费用总额 */
  totalDeductibleExpense: number
  /** [13] 利润总额 = [1] - [12] */
  totalProfit: number
  /** [14] 应交企业所得税 = max([13],0) × 所得税率 */
  payableIncomeTax: number
  /** [15] 净利润 = [13] - [14] */
  netProfit: number
  /** [16] 总税费 = [10] + [11] + [14] */
  totalTax: number
}

/** 利润指标 */
export interface ProfitMetrics {
  /** 净利率 % = 净利润 / 不含税销售额 × 100 */
  netMarginRate: number
  /** BOM 毛利率 % = (售价 - 含损耗 BOM) / 售价 × 100 */
  bomMarginRate: number
  /** 盈亏平衡量（件/月） */
  breakevenUnits: number
}

/** 供货价定价结果 */
export interface SupplyPriceResult {
  /** 保底价（不亏本） */
  supplyPriceFloor: number
  /** 建议价（系统算） */
  supplyPriceSuggested: number
  /** 顶价（市场锚定 × 0.95） */
  supplyPriceCeiling: number
  /** 最终报价（人工调整后；未填则等于建议价） */
  finalSupplyPrice: number
}

/** 预算对比结果 */
export interface BudgetVarianceResult {
  budgetTotal?: number
  /** 实际 - 预算 */
  budgetVariance?: number
  /** 差异率 % */
  budgetVarianceRate?: number
}

/** 自检告警 */
export interface CostAlert {
  id: string
  msg: string
  /** ERROR=阻断性问题；WARN=需关注；INFO=说明性提示 */
  severity: 'WARN' | 'ERROR' | 'INFO'
}

/** 完整成本计算结果 */
export interface CostResult
  extends TotalCostResult,
          TaxResult,
          ProfitMetrics,
          SupplyPriceResult,
          BudgetVarianceResult {
  /** 不含税采购成本（用于税费计算的中间值） */
  purchaseCostExclVat: number
  /** 不含税快递费 */
  freightExclVat: number
  /** 自检告警列表 */
  alerts: CostAlert[]
}

// ── 工具函数 ──────────────────────────────────────────

/** 四舍五入到 2 位小数（避免浮点误差） */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 四舍五入到 4 位小数（用于差异率等需要精度的场景） */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
