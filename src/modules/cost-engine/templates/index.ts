/**
 * Product Cost Templates - 4类专用
 * 用户只做：普通食品、保健食品、跨境食品、化妆品
 */

import type { ProductCostTemplate } from "../modules/types";

export const REGULAR_FOOD_TEMPLATE: ProductCostTemplate = {
  id: "regular_food",
  name: "普通食品",
  description: "饼干、糕点、糖果、饮料等，SC认证",
  category: "普通食品",
  icon: "🍪",
  modules: [
    { moduleId: "material", enabled: true, values: { materialCost: 5, lossRate: 3, ingredientCount: 5 } },
    { moduleId: "formulation", enabled: true, values: { formulationCost: 0.2, servings: 1 } },
    { moduleId: "manufacturing", enabled: true, values: { manufacturingCost: 1.2, batchSize: 2000 } },
    { moduleId: "packaging", enabled: true, values: { packagingCost: 0.8, innerPackagingCost: 0.3 } },
    { moduleId: "certification", enabled: true, values: { certificationCost: 0.15, testCount: 2 } },
    { moduleId: "logistics", enabled: true, values: { freightBase: 4, storageCost: 0.1, expressType: "STANDARD" } },
    { moduleId: "channel", enabled: true, values: { platformFeeRate: 2, commissionRate: 20, marketingRate: 8, returnRate: 5, retailPrice: 39.9 } },
    { moduleId: "overhead", enabled: false, values: { monthlyFixed: 0, monthlySales: 2000 } },
  ],
  defaults: { channel: "XINXUAN", expressType: "STANDARD", invoiceType: "达人开票" },
};

export const HEALTH_FOOD_TEMPLATE: ProductCostTemplate = {
  id: "health_food",
  name: "保健食品",
  description: "软糖、胶囊、粉剂等，蓝帽子备案/注册，功能性检测",
  category: "保健食品",
  icon: "💊",
  modules: [
    { moduleId: "material", enabled: true, values: { materialCost: 8.05, lossRate: 3, ingredientCount: 3 } },
    { moduleId: "formulation", enabled: true, values: { formulationCost: 0.8, dosage: 500, servings: 30 } },
    { moduleId: "encapsulation", enabled: true, values: { encapsulationCost: 1.5, capsuleType: "gummy", capsuleCount: 60 } },
    { moduleId: "manufacturing", enabled: true, values: { manufacturingCost: 1.8, batchSize: 1000 } },
    { moduleId: "certification", enabled: true, values: { certificationCost: 1.2, testCount: 4 } },
    { moduleId: "compliance", enabled: true, values: { complianceCost: 2.5, complianceType: "health_filing", filingFee: 50000, filingAmortization: 10000 } },
    { moduleId: "packaging", enabled: true, values: { packagingCost: 1.8, innerPackagingCost: 0.6, giftBox: 0 } },
    { moduleId: "logistics", enabled: true, values: { freightBase: 4, storageCost: 0.2, expressType: "STANDARD" } },
    { moduleId: "channel", enabled: true, values: { platformFeeRate: 2, commissionRate: 25, marketingRate: 10, returnRate: 5, retailPrice: 199 } },
    { moduleId: "overhead", enabled: true, values: { monthlyFixed: 8000, monthlySales: 1000 } },
  ],
  defaults: { channel: "XINXUAN", expressType: "STANDARD", invoiceType: "达人开票" },
};

export const CROSS_BORDER_FOOD_TEMPLATE: ProductCostTemplate = {
  id: "cross_border_food",
  name: "跨境食品",
  description: "进口食品，国际物流+关税+清关+中文标签",
  category: "跨境食品",
  icon: "🌍",
  modules: [
    { moduleId: "material", enabled: true, values: { materialCost: 12, lossRate: 2, ingredientCount: 4, importCost: 8, importRate: 0 } },
    { moduleId: "international_logistics", enabled: true, values: { internationalFreight: 3.5, customsFee: 1.2, tariffRate: 12, tariffCost: 0, clearanceFee: 0.8 } },
    { moduleId: "manufacturing", enabled: true, values: { manufacturingCost: 1.0, batchSize: 1000 } },
    { moduleId: "compliance", enabled: true, values: { complianceCost: 1.5, complianceType: "cross_border", filingFee: 8000, filingAmortization: 5000, labelCost: 0.5, labelFee: 0.5 } },
    { moduleId: "certification", enabled: true, values: { certificationCost: 0.6, testCount: 3 } },
    { moduleId: "packaging", enabled: true, values: { packagingCost: 1.5, innerPackagingCost: 0.5 } },
    { moduleId: "logistics", enabled: true, values: { freightBase: 5, storageCost: 0.3, expressType: "STANDARD", bondedWarehouse: 0.5 } },
    { moduleId: "channel", enabled: true, values: { platformFeeRate: 3, commissionRate: 22, marketingRate: 12, returnRate: 8, retailPrice: 129 } },
    { moduleId: "overhead", enabled: true, values: { monthlyFixed: 6000, monthlySales: 800 } },
  ],
  defaults: { channel: "XINXUAN", expressType: "STANDARD", invoiceType: "达人开票" },
};

export const COSMETICS_TEMPLATE: ProductCostTemplate = {
  id: "cosmetics",
  name: "化妆品",
  description: "护肤、彩妆等，包材贵、检测多、备案/注册",
  category: "化妆品",
  icon: "💄",
  modules: [
    { moduleId: "material", enabled: true, values: { materialCost: 15, lossRate: 2, ingredientCount: 8 } },
    { moduleId: "formulation", enabled: true, values: { formulationCost: 1.2, dosage: 50, servings: 1 } },
    { moduleId: "manufacturing", enabled: true, values: { manufacturingCost: 2.5, batchSize: 1000, fillingCost: 1.0 } },
    { moduleId: "packaging", enabled: true, values: { packagingCost: 8, innerPackagingCost: 2, giftBox: 1, bottleCost: 5, bottleType: "glass" } },
    { moduleId: "certification", enabled: true, values: { certificationCost: 1.5, testCount: 5, safetyTest: 1, efficacyTest: 1 } },
    { moduleId: "compliance", enabled: true, values: { complianceCost: 3.0, complianceType: "cosmetics_filing", filingFee: 30000, filingAmortization: 5000, efficacyClaim: 1 } },
    { moduleId: "logistics", enabled: true, values: { freightBase: 5, storageCost: 0.3, expressType: "STANDARD", fragileFee: 0.5 } },
    { moduleId: "channel", enabled: true, values: { platformFeeRate: 3, commissionRate: 30, marketingRate: 15, returnRate: 10, retailPrice: 299 } },
    { moduleId: "overhead", enabled: true, values: { monthlyFixed: 10000, monthlySales: 500 } },
  ],
  defaults: { channel: "XINXUAN", expressType: "STANDARD", invoiceType: "达人开票" },
};

export const CUSTOM_TEMPLATE: ProductCostTemplate = {
  id: "custom",
  name: "自定义",
  description: "自定义成本结构，自选模块",
  category: "自定义",
  icon: "✨",
  modules: [
    { moduleId: "material", enabled: true, values: {} },
    { moduleId: "packaging", enabled: true, values: {} },
    { moduleId: "logistics", enabled: true, values: {} },
    { moduleId: "channel", enabled: true, values: { retailPrice: 99 } },
    { moduleId: "custom", enabled: false, values: {} },
  ],
};

export const COST_TEMPLATES: Record<string, ProductCostTemplate> = {
  regular_food: REGULAR_FOOD_TEMPLATE,
  health_food: HEALTH_FOOD_TEMPLATE,
  cross_border_food: CROSS_BORDER_FOOD_TEMPLATE,
  cosmetics: COSMETICS_TEMPLATE,
  custom: CUSTOM_TEMPLATE,
};

export function getTemplate(id: string): ProductCostTemplate | null {
  return COST_TEMPLATES[id] || null;
}

export function listTemplates(): ProductCostTemplate[] {
  return Object.values(COST_TEMPLATES);
}

export function getTemplateForProduct(productName?: string, category?: string): ProductCostTemplate {
  const name = (productName || "").toLowerCase();
  const cat = (category || "").toLowerCase();
  
  // 保健食品
  if (name.includes("多酚") || name.includes("软糖") || name.includes("胶囊") || name.includes("保健") || name.includes("膳食") || name.includes("补充") || cat.includes("保健")) {
    return HEALTH_FOOD_TEMPLATE;
  }
  // 跨境食品
  if (name.includes("跨境") || name.includes("进口") || name.includes("海外") || cat.includes("跨境") || cat.includes("进口")) {
    return CROSS_BORDER_FOOD_TEMPLATE;
  }
  // 化妆品
  if (name.includes("化妆") || name.includes("护肤") || name.includes("面膜") || name.includes("精华") || name.includes("口红") || name.includes("彩妆") || cat.includes("化妆") || cat.includes("美妆")) {
    return COSMETICS_TEMPLATE;
  }
  // 普通食品默认
  if (cat.includes("食品") || name.includes("饼") || name.includes("糕") || name.includes("饮料") || name.includes("零食")) {
    return REGULAR_FOOD_TEMPLATE;
  }
  // 默认保健食品（当前项目多酚）
  return HEALTH_FOOD_TEMPLATE;
}
