/**
 * 4 类专用成本模板（本地补齐）
 * ----------------------------
 * Arena 工作区未交付本文件，但 modules/calculator.ts 的 `calculateCostForProduct`
 * 会 `require("../templates")` 取 `getTemplateForProduct` —— 缺它则该函数运行时必崩。
 *
 * 本实现按交付文档还原：
 *   - MODULAR_COST_DELIVERY.md「产品模板 templates/index.ts - 6个模板」的角色与默认值
 *   - MASTER_PLAN_4CAT.md「4类差异本质」表中的类别差异
 * 默认值取自文档明写的数字（多酚原料 8.05 / 损耗 3% / 配方 0.5 / 剂型 1.2 / 检测 0.8
 * / 物流 4.2 / 固定 5000；普通食品常温 4 元、零售 39.9；化妆品包材玻璃瓶 5 元等），
 * 未在文档中出现的字段留 0，由用户在前端填写。
 */

import type { CostModuleInstance, ProductCostTemplate } from "../modules/types";

const on = (moduleId: string, values: Record<string, number | string> = {}): CostModuleInstance => ({
  moduleId,
  enabled: true,
  values,
});

const off = (moduleId: string, values: Record<string, number | string> = {}): CostModuleInstance => ({
  moduleId,
  enabled: false,
  values,
});

/** 普通食品：原料 + 加工 + 包装 + 认证 + 物流 + 渠道 + 固定。 */
export const FOOD_TEMPLATE: ProductCostTemplate = {
  id: "food",
  name: "普通食品模板",
  description: "常温流通的低价快消品：渠道费率高、无明显剂型成本",
  category: "普通食品",
  icon: "🍪",
  modules: [
    on("material", { materialCost: 0.98, ingredientCount: 4, lossRate: 3 }),
    on("manufacturing", { manufacturingCost: 1.2, batchSize: 10000 }),
    on("packaging", { packagingCost: 1.1, innerPackagingCost: 0, giftBox: 0 }),
    on("certification", { certificationCost: 0.2, testCount: 2 }),
    on("logistics", { freightBase: 4, isColdChain: "否", storageCost: 0, expressType: "STANDARD" }),
    on("channel", { retailPrice: 39.9, platformFeeRate: 5, commissionRate: 15, marketingRate: 15, returnRate: 0 }),
    on("overhead", { monthlyFixed: 0, monthlySales: 1000 }),
  ],
  defaults: { channel: "电商", expressType: "STANDARD" },
};

/** 保健食品：多酚软糖样板，文档中唯一给了完整默认值的模板。 */
export const SUPPLEMENT_TEMPLATE: ProductCostTemplate = {
  id: "supplement",
  name: "保健食品模板",
  description: "高原料成本 + 剂型 + 配方研发 + 蓝帽子检测，渠道费率最高",
  category: "保健食品",
  icon: "💊",
  modules: [
    on("material", { materialCost: 8.05, ingredientCount: 6, lossRate: 3 }),
    on("formulation", { formulationCost: 0.5, dosage: 0, servings: 1 }),
    on("encapsulation", { encapsulationCost: 1.2, capsuleType: "植物胶囊", capsuleCount: 60 }),
    on("manufacturing", { manufacturingCost: 1.5, batchSize: 5000 }),
    on("certification", { certificationCost: 0.8, testCount: 3 }),
    on("packaging", { packagingCost: 1.6, innerPackagingCost: 0.4, giftBox: 0 }),
    on("logistics", { freightBase: 4.2, isColdChain: "否", storageCost: 0, expressType: "STANDARD" }),
    on("channel", { retailPrice: 199, platformFeeRate: 5, commissionRate: 20, marketingRate: 17, returnRate: 0 }),
    on("overhead", { monthlyFixed: 5000, monthlySales: 1000 }),
  ],
  defaults: { channel: "电商", expressType: "STANDARD" },
};

/** 饮料/冲调：有配方但无剂型包装成本，不做固定成本摊销。 */
export const BEVERAGE_TEMPLATE: ProductCostTemplate = {
  id: "beverage",
  name: "饮料冲调模板",
  description: "液体/粉剂，配方与包装主导，无剂型成本",
  category: "饮料",
  icon: "🥤",
  modules: [
    on("material", { materialCost: 1.2, ingredientCount: 5, lossRate: 2 }),
    on("formulation", { formulationCost: 0.3, dosage: 0, servings: 1 }),
    on("manufacturing", { manufacturingCost: 0.9, batchSize: 10000 }),
    on("packaging", { packagingCost: 1.3, innerPackagingCost: 0, giftBox: 0 }),
    on("logistics", { freightBase: 4.5, isColdChain: "否", storageCost: 0, expressType: "STANDARD" }),
    on("channel", { retailPrice: 59, platformFeeRate: 5, commissionRate: 15, marketingRate: 15, returnRate: 0 }),
    off("certification"),
    off("overhead"),
  ],
  defaults: { channel: "电商", expressType: "STANDARD" },
};

/** 电子：无配方/剂型，检测项多，礼盒与顺丰常见。 */
export const ELECTRONICS_TEMPLATE: ProductCostTemplate = {
  id: "electronics",
  name: "电子产品模板",
  description: "元器件 + 组装 + 测试，包装偏重礼盒",
  category: "电子",
  icon: "🔌",
  modules: [
    on("material", { materialCost: 20, ingredientCount: 12, lossRate: 1 }),
    on("manufacturing", { manufacturingCost: 6, batchSize: 2000 }),
    on("certification", { certificationCost: 1.5, testCount: 6 }),
    on("packaging", { packagingCost: 1.5, innerPackagingCost: 0.5, giftBox: 2 }),
    on("logistics", { freightBase: 8, isColdChain: "否", storageCost: 0, expressType: "EXPRESS" }),
    on("channel", { retailPrice: 299, platformFeeRate: 5, commissionRate: 15, marketingRate: 15, returnRate: 0 }),
    on("overhead", { monthlyFixed: 0, monthlySales: 1000 }),
    off("formulation"),
    off("encapsulation"),
  ],
  defaults: { channel: "电商", expressType: "EXPRESS" },
};

/** 服装：面料+辅料+缝制+质检。 */
export const APPAREL_TEMPLATE: ProductCostTemplate = {
  id: "apparel",
  name: "服装模板",
  description: "面料与辅料主导，质检后包装",
  category: "服装",
  icon: "👕",
  modules: [
    on("material", { materialCost: 15, ingredientCount: 5, lossRate: 5 }),
    on("manufacturing", { manufacturingCost: 8, batchSize: 1000 }),
    on("certification", { certificationCost: 0.3, testCount: 2 }),
    on("packaging", { packagingCost: 1.2, innerPackagingCost: 0.3, giftBox: 0 }),
    on("logistics", { freightBase: 5, isColdChain: "否", storageCost: 0, expressType: "STANDARD" }),
    on("channel", { retailPrice: 159, platformFeeRate: 5, commissionRate: 20, marketingRate: 20, returnRate: 0 }),
    off("formulation"),
    off("encapsulation"),
    off("overhead"),
  ],
  defaults: { channel: "电商", expressType: "STANDARD" },
};

/** 自定义：全部模块预置但默认关闭，由用户自行启用。 */
export const CUSTOM_TEMPLATE: ProductCostTemplate = {
  id: "custom",
  name: "自定义模板",
  description: "空白模板，按需启用模块",
  category: "自定义",
  icon: "✨",
  modules: [
    on("material"),
    off("formulation"),
    off("encapsulation"),
    off("manufacturing"),
    off("certification"),
    off("packaging"),
    off("logistics"),
    on("channel"),
    off("overhead"),
    off("custom"),
  ],
  defaults: { channel: "电商" },
};

export const COST_TEMPLATES: ProductCostTemplate[] = [
  FOOD_TEMPLATE,
  SUPPLEMENT_TEMPLATE,
  BEVERAGE_TEMPLATE,
  ELECTRONICS_TEMPLATE,
  APPAREL_TEMPLATE,
  CUSTOM_TEMPLATE,
];

export const COST_TEMPLATE_MAP: Record<string, ProductCostTemplate> = Object.fromEntries(
  COST_TEMPLATES.map((t) => [t.id, t])
);

/** 按文档给出的识别词表匹配模板；命中不了时回落到普通食品。 */
const SUPPLEMENT_HINTS = ["多酚", "胶囊", "保健", "软糖", "片剂", "营养素", "膳食"];
const BEVERAGE_HINTS = ["饮料", "冲调", "茶", "咖啡", "果汁"];
const ELECTRONICS_HINTS = ["电子", "元器件", "充电", "电路", "芯片"];
const APPAREL_HINTS = ["服装", "面料", "服饰", "衣"];

export function getTemplateForProduct(productName: string, category?: string): ProductCostTemplate {
  const text = `${productName || ""} ${category || ""}`;
  if (SUPPLEMENT_HINTS.some((w) => text.includes(w))) return SUPPLEMENT_TEMPLATE;
  if (BEVERAGE_HINTS.some((w) => text.includes(w))) return BEVERAGE_TEMPLATE;
  if (ELECTRONICS_HINTS.some((w) => text.includes(w))) return ELECTRONICS_TEMPLATE;
  if (APPAREL_HINTS.some((w) => text.includes(w))) return APPAREL_TEMPLATE;
  if (text.includes("食品")) return FOOD_TEMPLATE;
  return CUSTOM_TEMPLATE;
}
