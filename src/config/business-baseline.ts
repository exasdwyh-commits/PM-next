/**
 * P1-02 业务基线：关键证据缺口是否阻断提交，由服务端执行（见 product-suggestion.commitProductSuggestionToGate）。
 * 当前为常量配置；组织(org)粒度分化后可迁至数据库表，不暴露给前端决定。
 */

export const BUSINESS_BASELINE = {
  /** 竞品价格/价格带为全局必填的关键字段（无则阻断提交） */
  priceRequired: true,
  /** 机会类型为「爆品跟进」时，额外要求销量证据已核实 */
  followHitRequiresSalesVolume: true,
} as const;

/** 基线对应的关键字段名（与 computeEvidenceGaps 的 fieldKey 约定一致） */
export const BASELINE_FIELD = {
  price: "price",
  salesVolume: "salesVolume",
} as const;