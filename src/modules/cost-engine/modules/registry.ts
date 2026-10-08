/**
 * Cost Module Registry - 4类专用：普通食品、保健食品、跨境食品、化妆品
 */

import { num, str, type CostModuleDef } from "./types";

// 原料模块
export const materialModule: CostModuleDef = {
  id: "material",
  label: "原料成本",
  icon: "🌱",
  category: "material",
  description: "直接材料，配方原料采购价",
  fields: [
    { key: "materialCost", label: "原料成本", unit: "元/件", type: "number", required: true, step: "0.01", hint: "所有原料采购价合计" },
    { key: "ingredientCount", label: "原料种类数", unit: "种", type: "number", defaultValue: 3, hint: "用于损耗计算" },
    { key: "lossRate", label: "损耗率", unit: "%", type: "percent", defaultValue: 3, hint: "加工损耗，默认3%" },
    { key: "importCost", label: "进口原料成本", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "跨境食品：进口原料额外成本" },
  ],
  calculate: (values) => {
    const materialCost = num(values, "materialCost");
    const importCost = num(values, "importCost");
    const lossRate = num(values, "lossRate", 3);
    const cost = (materialCost + importCost) * (1 + lossRate / 100);
    return {
      cost,
      breakdown: { 原料: materialCost, 进口: importCost, 损耗: cost - materialCost - importCost },
      notes: lossRate > 5 ? ["损耗率偏高，建议优化工艺"] : [],
    };
  },
};

// 配方模块
export const formulationModule: CostModuleDef = {
  id: "formulation",
  label: "配方工艺",
  icon: "🧪",
  category: "formulation",
  description: "配方设计、剂量、剂型",
  fields: [
    { key: "formulationCost", label: "配方成本", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "配方研发均摊或特殊工艺" },
    { key: "dosage", label: "含量/规格", unit: "mg/g/ml", type: "number", hint: "如多酚500mg，面霜50g" },
    { key: "servings", label: "含量数", unit: "粒/次/件", type: "number", defaultValue: 30, hint: "一盒数量" },
  ],
  calculate: (values) => {
    const cost = num(values, "formulationCost");
    return { cost, breakdown: { 配方: cost } };
  },
};

// 制造模块
export const manufacturingModule: CostModuleDef = {
  id: "manufacturing",
  label: "制造成本",
  icon: "🏭",
  category: "manufacturing",
  description: "加工、灌装、压片、组装",
  fields: [
    { key: "manufacturingCost", label: "加工费", unit: "元/件", type: "number", required: true, step: "0.01", hint: "代工厂加工费" },
    { key: "fillingCost", label: "灌装费", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "化妆品灌装" },
    { key: "batchSize", label: "批量", unit: "件/批", type: "number", defaultValue: 1000, hint: "批量越大单件越低" },
  ],
  calculate: (values) => {
    const manufacturing = num(values, "manufacturingCost");
    const filling = num(values, "fillingCost");
    return { cost: manufacturing + filling, breakdown: { 加工: manufacturing, 灌装: filling } };
  },
};

// 胶囊/剂型模块 - 保健食品
export const encapsulationModule: CostModuleDef = {
  id: "encapsulation",
  label: "剂型成本",
  icon: "💊",
  category: "manufacturing",
  description: "软糖、胶囊、粉剂等剂型",
  fields: [
    { key: "encapsulationCost", label: "剂型成本", unit: "元/件", type: "number", required: true, step: "0.01", hint: "胶囊壳/软糖成型/粉剂分装" },
    { key: "capsuleType", label: "剂型", unit: "", type: "select", defaultValue: "gummy", options: [{ value: "gummy", label: "软糖" }, { value: "plant", label: "植物胶囊" }, { value: "gelatin", label: "明胶胶囊" }, { value: "tablet", label: "压片" }, { value: "powder", label: "粉剂" }, { value: "liquid", label: "口服液" }] },
    { key: "capsuleCount", label: "数量", unit: "粒/件", type: "number", defaultValue: 60 },
  ],
  calculate: (values) => {
    return { cost: num(values, "encapsulationCost"), breakdown: { 剂型: num(values, "encapsulationCost") } };
  },
};

// 包装模块
export const packagingModule: CostModuleDef = {
  id: "packaging",
  label: "包装成本",
  icon: "📦",
  category: "packaging",
  description: "外包装 + 内包装 + 瓶/盒",
  fields: [
    { key: "packagingCost", label: "外包装", unit: "元/件", type: "number", required: true, step: "0.01", hint: "纸盒、彩盒" },
    { key: "innerPackagingCost", label: "内包装", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "铝箔袋、内衬" },
    { key: "bottleCost", label: "瓶/罐成本", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "化妆品瓶、保健品瓶" },
    { key: "bottleType", label: "瓶型", unit: "", type: "select", defaultValue: "pet", options: [{ value: "pet", label: "PET塑料瓶" }, { value: "glass", label: "玻璃瓶" }, { value: "pouch", label: "自立袋" }, { value: "box", label: "纸盒" }, { value: "tube", label: "软管" }] },
    { key: "giftBox", label: "礼盒", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "礼盒额外成本" },
  ],
  calculate: (values) => {
    const outer = num(values, "packagingCost");
    const inner = num(values, "innerPackagingCost");
    const bottle = num(values, "bottleCost");
    const gift = num(values, "giftBox");
    return { cost: outer + inner + bottle + gift, breakdown: { 外包装: outer, 内包装: inner, 瓶罐: bottle, 礼盒: gift } };
  },
};

// 物流模块
export const logisticsModule: CostModuleDef = {
  id: "logistics",
  label: "物流仓储",
  icon: "🚚",
  category: "logistics",
  description: "快递 + 仓储",
  fields: [
    { key: "freightBase", label: "快递费", unit: "元/件", type: "number", defaultValue: 4, step: "0.1", hint: "普通4元，冷链5.5，顺丰8，高端15" },
    { key: "expressType", label: "快递类型", unit: "", type: "select", defaultValue: "STANDARD", options: [{ value: "STANDARD", label: "普通快递" }, { value: "COLD_CHAIN", label: "冷链" }, { value: "SF_EXPRESS", label: "顺丰" }, { value: "PREMIUM", label: "高端" }] },
    { key: "storageCost", label: "仓储费", unit: "元/件", type: "number", defaultValue: 0, step: "0.01" },
    { key: "bondedWarehouse", label: "保税仓费", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "跨境：保税仓" },
    { key: "fragileFee", label: "易碎费", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "化妆品玻璃瓶" },
  ],
  calculate: (values) => {
    let freight = num(values, "freightBase", 4);
    if (str(values, "expressType") === "COLD_CHAIN") freight = Math.max(freight, 5.5);
    if (str(values, "expressType") === "SF_EXPRESS") freight = Math.max(freight, 8);
    if (str(values, "expressType") === "PREMIUM") freight = Math.max(freight, 15);
    const storage = num(values, "storageCost");
    const bonded = num(values, "bondedWarehouse");
    const fragile = num(values, "fragileFee");
    return { cost: freight + storage + bonded + fragile, breakdown: { 快递: freight, 仓储: storage, 保税仓: bonded, 易碎: fragile } };
  },
};

// 国际物流模块 - 跨境专用
export const internationalLogisticsModule: CostModuleDef = {
  id: "international_logistics",
  label: "国际物流+关税",
  icon: "🌍",
  category: "logistics",
  description: "跨境：国际运费、关税、清关",
  fields: [
    { key: "internationalFreight", label: "国际运费", unit: "元/件", type: "number", required: true, step: "0.01", hint: "海运/空运均摊" },
    { key: "tariffRate", label: "关税率", unit: "%", type: "percent", defaultValue: 12, hint: "食品通常10-15%" },
    { key: "tariffCost", label: "关税额", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "或按比例自动算" },
    { key: "customsFee", label: "报关费", unit: "元/件", type: "number", defaultValue: 1.2, step: "0.01" },
    { key: "clearanceFee", label: "清关费", unit: "元/件", type: "number", defaultValue: 0.8, step: "0.01" },
    { key: "vatRate", label: "进口增值税率", unit: "%", type: "percent", defaultValue: 13, hint: "通常13%" },
  ],
  calculate: (values) => {
    const intlFreight = num(values, "internationalFreight");
    const customsFee = num(values, "customsFee");
    const clearanceFee = num(values, "clearanceFee");
    let tariffCost = num(values, "tariffCost");
    // 如果没填关税额，按比例算：假设货值12元，关税12%
    if (tariffCost === 0 && num(values, "tariffRate") > 0) {
      const goodsValue = 12; // 假设货值，可配置
      tariffCost = goodsValue * (num(values, "tariffRate") / 100);
    }
    const total = intlFreight + tariffCost + customsFee + clearanceFee;
    return {
      cost: total,
      breakdown: { 国际运费: intlFreight, 关税: tariffCost, 报关: customsFee, 清关: clearanceFee },
      notes: tariffCost > 3 ? ["关税较高，考虑一般贸易 vs 跨境电商税率"] : [],
    };
  },
};

// 认证检测模块
export const certificationModule: CostModuleDef = {
  id: "certification",
  label: "检测认证",
  icon: "🔬",
  category: "certification",
  description: "检测、备案、认证均摊",
  fields: [
    { key: "certificationCost", label: "检测费", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "检测报告均摊" },
    { key: "testCount", label: "检测项", unit: "项", type: "number", defaultValue: 2, hint: "检测项目数量" },
    { key: "safetyTest", label: "安全检测", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "化妆品安全检测" },
    { key: "efficacyTest", label: "功效检测", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "化妆品功效检测" },
  ],
  calculate: (values) => {
    const cert = num(values, "certificationCost");
    const safety = num(values, "safetyTest");
    const efficacy = num(values, "efficacyTest");
    return { cost: cert + safety + efficacy, breakdown: { 检测: cert, 安全: safety, 功效: efficacy } };
  },
};

// 合规模块 - 4类核心差异
export const complianceModule: CostModuleDef = {
  id: "compliance",
  label: "合规成本",
  icon: "📋",
  category: "certification",
  description: "备案、注册、标签、合规",
  fields: [
    { key: "complianceCost", label: "合规均摊", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "备案/注册费均摊到单件" },
    { key: "complianceType", label: "合规类型", unit: "", type: "select", defaultValue: "food_sc", options: [
      { value: "food_sc", label: "普通食品 SC" },
      { value: "health_filing", label: "保健食品备案" },
      { value: "health_registration", label: "保健食品注册(蓝帽)" },
      { value: "cross_border", label: "跨境食品备案" },
      { value: "cosmetics_filing", label: "化妆品备案" },
      { value: "cosmetics_registration", label: "化妆品注册(特殊)" },
    ] },
    { key: "filingFee", label: "备案/注册费", unit: "元", type: "number", defaultValue: 0, step: "100", hint: "一次性费用" },
    { key: "filingAmortization", label: "摊销量", unit: "件", type: "number", defaultValue: 10000, hint: "按多少件摊" },
    { key: "labelCost", label: "标签费", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "中文标签、设计" },
    { key: "efficacyClaim", label: "功效宣称", unit: "元/件", type: "number", defaultValue: 0, step: "0.01", hint: "化妆品功效宣称成本" },
  ],
  calculate: (values) => {
    const compliance = num(values, "complianceCost");
    const filingFee = num(values, "filingFee");
    const amortization = num(values, "filingAmortization", 10000);
    const filingPerUnit = filingFee > 0 ? filingFee / amortization : 0;
    const labelCost = num(values, "labelCost") || num(values, "labelFee");
    const efficacyClaim = num(values, "efficacyClaim");
    const total = compliance + filingPerUnit + labelCost + efficacyClaim;

    const notes: string[] = [];
    // filingFee 是「一次性总费用」(元)，与市场参考价 20万/5万 同量纲，可直接比。
    // 早前写成拿它与摊销额比较，导致提示恒真，已改为直接比总费用。
    if (str(values, "complianceType") === "health_registration" && filingFee > 0 && filingFee < 200000) notes.push("保健食品注册通常20万+，请确认填写的是一次性总费用还是单件均摊");
    if (str(values, "complianceType") === "cosmetics_registration" && filingFee > 0 && filingFee < 50000) notes.push("特殊化妆品注册通常5万+，请确认填写的是一次性总费用还是单件均摊");
    if (str(values, "complianceType") === "cross_border") notes.push("跨境需确认正面清单、中文标签、保税仓");

    return {
      cost: total,
      breakdown: { 合规: compliance, 备案摊: filingPerUnit, 标签: labelCost, 功效: efficacyClaim },
      notes,
    };
  },
};

// 渠道费用模块
export const channelModule: CostModuleDef = {
  id: "channel",
  label: "渠道费用",
  icon: "📈",
  category: "channel",
  description: "平台费、佣金、推广、退货",
  fields: [
    { key: "platformFeeRate", label: "平台费率", unit: "%", type: "percent", defaultValue: 2, hint: "平台服务费" },
    { key: "commissionRate", label: "佣金率", unit: "%", type: "percent", defaultValue: 20, hint: "达人/团长佣金" },
    { key: "marketingRate", label: "推广费率", unit: "%", type: "percent", defaultValue: 8, hint: "投流推广" },
    { key: "returnRate", label: "退货率", unit: "%", type: "percent", defaultValue: 5, hint: "退货退款" },
    { key: "retailPrice", label: "零售价", unit: "元", type: "number", required: true, step: "0.01", hint: "含税零售价，用于计算渠道费用" },
  ],
  calculate: (values) => {
    const retailPrice = num(values, "retailPrice");
    const platformFee = retailPrice * (num(values, "platformFeeRate")) / 100;
    const commission = retailPrice * (num(values, "commissionRate")) / 100;
    const marketing = retailPrice * (num(values, "marketingRate")) / 100;
    const returnRefund = retailPrice * (num(values, "returnRate")) / 100;
    const total = platformFee + commission + marketing + returnRefund;
    return {
      cost: total,
      breakdown: { 平台费: platformFee, 佣金: commission, 推广: marketing, 退货: returnRefund },
    };
  },
  roleVariants: {
    leadership: { hidden: true },
    sales: { label: "渠道与利润", desc: "平台费、佣金、推广，算出利润空间" },
  },
};

// 固定成本模块
export const overheadModule: CostModuleDef = {
  id: "overhead",
  label: "固定成本",
  icon: "🏢",
  category: "overhead",
  description: "团队工资、房租等月固定成本",
  fields: [
    { key: "monthlyFixed", label: "月固定成本", unit: "元/月", type: "number", defaultValue: 0, step: "1", hint: "仅用于盈亏平衡，不计入单件" },
    { key: "monthlySales", label: "预计月销量", unit: "件/月", type: "number", defaultValue: 1000, hint: "用于盈亏平衡计算" },
  ],
  calculate: (values) => {
    const monthlyFixed = num(values, "monthlyFixed");
    const monthlySales = num(values, "monthlySales", 1000);
    const perUnit = monthlySales > 0 ? monthlyFixed / monthlySales : 0;
    return {
      cost: 0,
      breakdown: { 月固定: monthlyFixed, 月销量: monthlySales, 单件摊派: perUnit },
      notes: [`月固定${monthlyFixed}元，按${monthlySales}件摊，单件${perUnit.toFixed(2)}元（仅参考，不计入成本）`],
    };
  },
  roleVariants: {
    leadership: { label: "盈亏平衡" },
  },
};

// 自定义模块
export const customModule: CostModuleDef = {
  id: "custom",
  label: "自定义成本",
  icon: "✨",
  category: "custom",
  description: "自定义成本项",
  fields: [
    { key: "customCost", label: "自定义成本", unit: "元/件", type: "number", defaultValue: 0, step: "0.01" },
    { key: "customLabel", label: "成本名称", unit: "", type: "select", defaultValue: "其他", options: [{ value: "其他", label: "其他" }, { value: "设计费", label: "设计费" }, { value: "专利费", label: "专利费" }, { value: "授权费", label: "授权费" }, { value: "关税", label: "关税" }, { value: "标签费", label: "标签费" }] },
  ],
  calculate: (values) => {
    return { cost: num(values, "customCost"), breakdown: { [String(values.customLabel || "其他")]: num(values, "customCost") } };
  },
};

// 注册表
export const COST_MODULE_REGISTRY: Record<string, CostModuleDef> = {
  material: materialModule,
  formulation: formulationModule,
  manufacturing: manufacturingModule,
  encapsulation: encapsulationModule,
  packaging: packagingModule,
  logistics: logisticsModule,
  international_logistics: internationalLogisticsModule,
  certification: certificationModule,
  compliance: complianceModule,
  channel: channelModule,
  overhead: overheadModule,
  custom: customModule,
};

export function getModuleDef(id: string): CostModuleDef | null {
  return COST_MODULE_REGISTRY[id] || null;
}

export function listModules(): CostModuleDef[] {
  return Object.values(COST_MODULE_REGISTRY);
}

export function listModulesByCategory(category: string): CostModuleDef[] {
  return Object.values(COST_MODULE_REGISTRY).filter(m => m.category === category);
}
