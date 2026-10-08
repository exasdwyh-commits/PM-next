/**
 * Modular Cost Calculator Engine - 4类专用
 */

import { COST_MODULE_REGISTRY } from "./registry";
import type { ProductCostTemplate, ModularCostResult } from "./types";

export function calculateModularCost(
  template: ProductCostTemplate,
  overrides?: Record<string, Record<string, number>>
): ModularCostResult {
  const moduleResults: ModularCostResult["modules"] = [];
  let totalMaterial = 0;
  let totalManufacturing = 0;
  let totalPackaging = 0;
  let totalLogistics = 0;
  let totalChannel = 0;
  let totalOverhead = 0;
  let totalCompliance = 0;
  let retailPrice = 0;

  for (const instance of template.modules) {
    if (!instance.enabled) continue;
    const def = COST_MODULE_REGISTRY[instance.moduleId];
    if (!def) continue;

    const values = { ...instance.values, ...(overrides?.[instance.moduleId] || {}) } as Record<string, number>;
    
    if (instance.moduleId === "channel" && values.retailPrice) {
      retailPrice = values.retailPrice;
    }

    const result = def.calculate(values, { template });

    moduleResults.push({
      moduleId: instance.moduleId,
      label: instance.customLabel || def.label,
      icon: def.icon,
      cost: result.cost,
      breakdown: result.breakdown,
      notes: result.notes,
    });

    switch (def.category) {
      case "material":
      case "formulation":
        totalMaterial += result.cost;
        break;
      case "manufacturing":
        totalManufacturing += result.cost;
        break;
      case "packaging":
        totalPackaging += result.cost;
        break;
      case "logistics":
        totalLogistics += result.cost;
        break;
      case "channel":
        totalChannel += result.cost;
        break;
      case "overhead":
        totalOverhead += result.cost;
        break;
      case "certification":
        // 认证：保健食品和化妆品检测多，算入制造或合规
        if (template.category === "化妆品" || template.category === "保健食品") {
          totalCompliance += result.cost;
        } else {
          totalManufacturing += result.cost;
        }
        break;
      case "custom":
        totalMaterial += result.cost;
        break;
    }

    // 合规模块单独
    if (instance.moduleId === "compliance") {
      totalCompliance += result.cost;
      // 从制造中扣除，避免重复
      totalManufacturing = Math.max(0, totalManufacturing - (def.category === "certification" ? 0 : 0));
    }
    if (instance.moduleId === "international_logistics") {
      totalLogistics += result.cost;
    }
  }

  // 总成本：原料+制造+包装+物流+渠道+合规
  const totalCost = totalMaterial + totalManufacturing + totalPackaging + totalLogistics + totalChannel + totalCompliance;

  const layer1Material = totalMaterial;
  const layer2Packaging = totalPackaging;
  const layer3Manufacturing = totalManufacturing + totalCompliance;
  const layer4Freight = totalLogistics;
  const layer5Channel = totalChannel;
  const layer6Allocation = totalOverhead;

  const netProfit = retailPrice > 0 ? retailPrice - totalCost : 0;
  const netMarginRate = retailPrice > 0 ? (netProfit / retailPrice) * 100 : 0;
  const monthlyFixed = (template.modules.find(m => m.moduleId === "overhead")?.values.monthlyFixed as number) || 0;
  const monthlySales = (template.modules.find(m => m.moduleId === "overhead")?.values.monthlySales as number) || 1000;
  const contributionMargin = retailPrice - (totalCost - totalChannel);
  const breakevenUnits = contributionMargin > 0 && monthlyFixed > 0 ? Math.ceil(monthlyFixed / contributionMargin) : 0;

  const targetMargin = 0.3;
  const supplyPriceFloor = totalCost * (1 + targetMargin);
  const supplyPriceSuggested = retailPrice > 0 ? retailPrice * 0.6 : supplyPriceFloor * 1.2;

  // 风险提示：供 HTML / Office 报告展示（基于已计算出的真实数据推导）
  const warnings: string[] = [];
  if (totalCost <= 0) {
    warnings.push("总成本为 0，请检查各成本模块的输入值");
  }
  if (retailPrice <= 0) {
    warnings.push("未设置零售价，无法测算毛利与盈亏平衡");
  } else {
    if (netMarginRate < 10) {
      warnings.push(`毛利率仅 ${netMarginRate.toFixed(1)}%，低于 10% 警戒线`);
    } else if (netMarginRate < 20) {
      warnings.push(`毛利率 ${netMarginRate.toFixed(1)}%，建议提升至 20% 以上`);
    }
  }
  if (totalCost > 0 && totalChannel / totalCost > 0.3) {
    warnings.push(`渠道成本占比 ${((totalChannel / totalCost) * 100).toFixed(1)}%（>30%），建议复核渠道结构`);
  }
  if (totalCompliance <= 0) {
    warnings.push("未计入合规成本，总成本可能被低估");
  }

  return {
    modules: moduleResults,
    totalMaterialCost: totalMaterial,
    totalManufacturingCost: totalManufacturing,
    totalPackagingCost: totalPackaging,
    totalLogisticsCost: totalLogistics,
    totalChannelCost: totalChannel,
    totalComplianceCost: totalCompliance,
    totalOverhead: totalOverhead,
    breakdown: {
      totalMaterial,
      totalManufacturing,
      totalPackaging,
      totalLogistics,
      totalChannel,
      totalCompliance,
      totalCost,
    },
    warnings,
    totalCost,
    layer1Material,
    layer2Packaging,
    layer3Manufacturing,
    layer4Freight,
    layer5Channel,
    layer6Allocation,
    retailPrice,
    netProfit,
    netMarginRate,
    breakevenUnits,
    supplyPriceFloor,
    supplyPriceSuggested,
  };
}

export function calculateCostForProduct(
  productName: string,
  category?: string,
  customValues?: Record<string, Record<string, number>>
): ModularCostResult {
  const { getTemplateForProduct } = require("../templates");
  const template = getTemplateForProduct(productName, category);
  return calculateModularCost(template, customValues);
}
