import { applyDefaults } from "@/modules/cost-engine";
import { CHANNEL_PRESETS, EXPRESS_PRESETS, INVOICE_PRESETS } from "@/modules/cost-engine/presets";
import type { Channel, CostInput, ExpressType, InvoiceType } from "@/modules/cost-engine/types";

/** The persisted scenario must use the same defaults and inputs as its displayed result. */
export function buildCostInput(form: Record<string, string>): CostInput {
  const number = (key: string, label: string, required = false): number | undefined => {
    const raw = form[key]?.trim();
    if (!raw) {
      if (required) throw new Error(`请填写「${label}」。`);
      return undefined;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`「${label}」必须是有效数字。`);
    if (value < 0) throw new Error(`「${label}」不能小于 0。`);
    return value;
  };
  const rate = (key: string, label: string, exclusiveMax = false): number | undefined => {
    const value = number(key, label);
    if (value !== undefined && (exclusiveMax ? value >= 100 : value > 100)) {
      throw new Error(`「${label}」${exclusiveMax ? "必须小于 100%" : "不能超过 100%"}。`);
    }
    return value;
  };
  const channel = form.channel as Channel;
  const invoiceType = form.invoiceType as InvoiceType;
  const expressType = form.expressType as ExpressType;
  if (!CHANNEL_PRESETS[channel] || !INVOICE_PRESETS[invoiceType] || !EXPRESS_PRESETS[expressType]) {
    throw new Error("请选择有效的渠道、发票与快递类型。");
  }
  const retailPrice = number("retailPrice", "含税零售价", true)!;
  if (retailPrice === 0) throw new Error("「含税零售价」必须大于 0。");
  const marketReferencePrice = number("marketReferencePrice", "市场参考价");
  if (marketReferencePrice === 0) throw new Error("「市场参考价」必须大于 0。");
  return applyDefaults({
    materialCost: number("materialCost", "直接材料成本", true)!,
    packagingCost: number("packagingCost", "外包装成本", true)!,
    manufacturingCost: number("manufacturingCost", "制造成本", true)!,
    certificationCost: number("certificationCost", "认证成本", true)!,
    monthlyFixed: number("monthlyFixed", "月固定成本", true)!,
    retailPrice,
    channel,
    invoiceType,
    expressType,
    commissionRate: rate("commissionRate", "达人佣金率") ?? CHANNEL_PRESETS[channel].commissionRate,
    platformFeeRate: rate("platformFeeRate", "平台服务费率") ?? CHANNEL_PRESETS[channel].platformFeeRate,
    marketingRate: rate("marketingRate", "推广费率") ?? CHANNEL_PRESETS[channel].marketingRate,
    marketReferencePrice,
    targetMarginRate: rate("targetMarginRate", "目标利润率", true),
  });
}
