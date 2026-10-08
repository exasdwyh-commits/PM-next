/**
 * 成本模块注册表（本地补齐）
 * --------------------------
 * Arena 工作区未交付本文件，但 modules/calculator.ts 依赖 `COST_MODULE_REGISTRY`。
 * 本实现严格按交付文档 MODULAR_COST_DELIVERY.md「模块注册表 registry.ts - 10个模块」
 * 一节的表格还原：模块 id / 图标 / 类别 / 字段 / 角色化 全部照表实现，未自创模块。
 *
 * 红线（MASTER_PLAN_4CAT.md）：成本必须机械化纯函数计算，AI 不参与算数。
 */

import type { CostField, CostModuleDef } from "./types";
import { DEFAULT_COLD_CHAIN_EXTRA } from "../presets";

const fields = (...list: CostField[]): CostField[] => list;

const num = (
  key: string,
  label: string,
  unit: string,
  defaultValue = 0,
  extra: Partial<CostField> = {}
): CostField => ({ key, label, unit, type: "number", defaultValue, ...extra });

const pct = (key: string, label: string, defaultValue = 0, extra: Partial<CostField> = {}): CostField => ({
  key,
  label,
  unit: "%",
  type: "percent",
  defaultValue,
  ...extra,
});

/**
 * 判定 select 型布尔字段（如 isColdChain）是否「是」。
 * 该字段的 options 是字符串 "是"/"否"，但如果值来自表单序列化或旧数据，
 * 也可能是 1/0/"1"。注意**不能**直接写 `values.x ? ...`：
 * "否" 是 truthy 字符串，会恒为真。两种表示都要认。
 */
const isAffirmative = (value: unknown): boolean =>
  value === 1 || value === "1" || value === true || value === "是";

/**
 * 原料：materialCost 为「裸料单价」，lossRate 为损耗百分比。
 * 成本 = materialCost × (1 + lossRate/100)，损耗单列进 breakdown 便于溯源。
 */
const materialModule: CostModuleDef = {
  id: "material",
  label: "原料",
  icon: "🌱",
  category: "material",
  description: "主料与辅料的单位成本，含损耗",
  fields: fields(
    num("materialCost", "原料成本", "元/件", 0, { required: true, hint: "裸料成本，不含损耗" }),
    num("ingredientCount", "原料种数", "种", 1, { min: 1 }),
    pct("lossRate", "损耗率", 3, { hint: "配料/灌装/烘烤损耗" })
  ),
  calculate: (values) => {
    const base = values.materialCost || 0;
    const lossRate = values.lossRate || 0;
    const loss = base * (lossRate / 100);
    return {
      cost: base + loss,
      breakdown: { 裸料: base, 损耗: loss },
      notes: lossRate > 0 ? [`损耗率 ${lossRate}%，折合 ¥${loss.toFixed(2)}/件`] : [],
    };
  },
};

/** 配方/工艺：按件摊销的研发与工艺成本。 */
const formulationModule: CostModuleDef = {
  id: "formulation",
  label: "配方",
  icon: "🧪",
  category: "formulation",
  description: "配方研发与工艺调试摊销",
  fields: fields(
    num("formulationCost", "配方成本", "元/件", 0, { required: true, hint: "按产量摊销后" }),
    num("dosage", "单件用量", "g", 0),
    num("servings", "单件份数", "份", 1, { min: 1 })
  ),
  calculate: (values) => {
    const cost = values.formulationCost || 0;
    return {
      cost,
      breakdown: { 配方: cost },
      notes: values.dosage ? [`单件用量 ${values.dosage}g`] : [],
    };
  },
};

/** 制造/加工：代工或自产的加工费。 */
const manufacturingModule: CostModuleDef = {
  id: "manufacturing",
  label: "制造",
  icon: "🏭",
  category: "manufacturing",
  description: "加工费（含人工与能耗）",
  fields: fields(
    num("manufacturingCost", "加工费", "元/件", 0, { required: true }),
    num("batchSize", "起订批量", "件", 0, { hint: "影响单价，仅记录" })
  ),
  calculate: (values) => {
    const cost = values.manufacturingCost || 0;
    return {
      cost,
      breakdown: { 加工: cost },
      notes: values.batchSize ? [`起订批量 ${values.batchSize} 件`] : [],
    };
  },
};

/** 剂型：软糖/胶囊/压片等成型成本，隶属制造类。 */
const encapsulationModule: CostModuleDef = {
  id: "encapsulation",
  label: "剂型",
  icon: "💊",
  category: "manufacturing",
  description: "软糖/胶囊/压片成型成本",
  fields: fields(
    num("encapsulationCost", "剂型成本", "元/件", 0, { required: true }),
    {
      key: "capsuleType",
      label: "剂型",
      unit: "",
      type: "select",
      defaultValue: "植物胶囊",
      options: [
        { value: "植物胶囊", label: "植物胶囊" },
        { value: "明胶胶囊", label: "明胶胶囊" },
        { value: "软糖", label: "软糖" },
        { value: "压片", label: "压片" },
        { value: "粉剂", label: "粉剂" },
      ],
    },
    num("capsuleCount", "单件粒数", "粒", 0)
  ),
  calculate: (values) => {
    const cost = values.encapsulationCost || 0;
    return {
      cost,
      breakdown: { 剂型: cost },
      notes: values.capsuleCount ? [`${values.capsuleCount} 粒/件`] : [],
    };
  },
};

/** 包装：外包装 + 内包装 + 礼盒。 */
const packagingModule: CostModuleDef = {
  id: "packaging",
  label: "包装",
  icon: "📦",
  category: "packaging",
  description: "外包装、内包装与礼盒",
  fields: fields(
    num("packagingCost", "外包装", "元/件", 0, { required: true }),
    num("innerPackagingCost", "内包装", "元/件", 0),
    num("giftBox", "礼盒", "元/件", 0)
  ),
  calculate: (values) => {
    const outer = values.packagingCost || 0;
    const inner = values.innerPackagingCost || 0;
    const gift = values.giftBox || 0;
    return {
      cost: outer + inner + gift,
      breakdown: { 外包装: outer, 内包装: inner, 礼盒: gift },
      notes: gift > 0 ? ["含礼盒，适合节日/礼赠场景"] : [],
    };
  },
};

/** 物流：快递底价 + 冷链附加 + 仓储。 */
const logisticsModule: CostModuleDef = {
  id: "logistics",
  label: "物流",
  icon: "🚚",
  category: "logistics",
  description: "快递、冷链与仓储",
  fields: fields(
    num("freightBase", "快递底价", "元/件", 0, { required: true }),
    {
      key: "isColdChain",
      label: "是否冷链",
      unit: "",
      type: "select",
      defaultValue: "否",
      options: [
        { value: "否", label: "否" },
        { value: "是", label: "是" },
      ],
    },
    num("storageCost", "仓储", "元/件", 0),
    {
      key: "expressType",
      label: "快递类型",
      unit: "",
      type: "select",
      defaultValue: "STANDARD",
      options: [
        { value: "STANDARD", label: "标准快递" },
        { value: "EXPRESS", label: "顺丰/特快" },
        { value: "ECONOMY", label: "经济件" },
      ],
    }
  ),
  calculate: (values) => {
    const base = values.freightBase || 0;
    const cold = isAffirmative(values.isColdChain) ? DEFAULT_COLD_CHAIN_EXTRA : 0;
    const storage = values.storageCost || 0;
    return {
      cost: base + cold + storage,
      breakdown: { 快递: base, 冷链: cold, 仓储: storage },
      notes: cold > 0 ? [`冷链附加 ¥${DEFAULT_COLD_CHAIN_EXTRA}/件`] : [],
    };
  },
};

/** 认证检测：按件摊销的检测与认证费。 */
const certificationModule: CostModuleDef = {
  id: "certification",
  label: "认证",
  icon: "🔬",
  category: "certification",
  description: "检测与认证费（按产量摊销）",
  fields: fields(
    num("certificationCost", "认证检测", "元/件", 0, { required: true, hint: "总费用/预计产量" }),
    num("testCount", "检测项数", "项", 0)
  ),
  calculate: (values) => {
    const cost = values.certificationCost || 0;
    return {
      cost,
      breakdown: { 认证检测: cost },
      notes: values.testCount ? [`${values.testCount} 项检测`] : [],
    };
  },
};

/**
 * 渠道：按零售价 × 各费率之和计算。
 * 角色化：领导视角隐藏（避免被平台费率淹没），销售视角改名为「渠道与利润」。
 */
const channelModule: CostModuleDef = {
  id: "channel",
  label: "渠道",
  icon: "📈",
  category: "channel",
  description: "平台扣点、佣金、推广与退货",
  fields: fields(
    num("retailPrice", "零售价", "元/件", 0, { required: true, hint: "渠道费率以此为基数" }),
    pct("platformFeeRate", "平台扣点", 0),
    pct("commissionRate", "达人佣金", 0),
    pct("marketingRate", "推广费", 0),
    pct("returnRate", "退货损耗", 0)
  ),
  calculate: (values) => {
    const retail = values.retailPrice || 0;
    const rateSum =
      (values.platformFeeRate || 0) +
      (values.commissionRate || 0) +
      (values.marketingRate || 0) +
      (values.returnRate || 0);
    const cost = retail * (rateSum / 100);
    return {
      cost,
      breakdown: { 渠道合计: cost },
      notes: retail > 0 ? [`费率合计 ${rateSum}% × 零售价 ¥${retail}`] : [],
    };
  },
  roleVariants: {
    leadership: { hidden: true },
    sales: { label: "渠道与利润", desc: "渠道费率越高，留给客户的价格空间越小" },
  },
};

/** 固定成本：月固定费用 ÷ 月销量 = 按件摊销。 */
const overheadModule: CostModuleDef = {
  id: "overhead",
  label: "固定",
  icon: "🏢",
  category: "overhead",
  description: "房租人力等固定成本摊销",
  fields: fields(
    num("monthlyFixed", "月固定成本", "元/月", 0),
    num("monthlySales", "月销量", "件", 0, { min: 1 })
  ),
  calculate: (values) => {
    const fixed = values.monthlyFixed || 0;
    const sales = values.monthlySales || 0;
    const perUnit = sales > 0 ? fixed / sales : 0;
    return {
      cost: perUnit,
      breakdown: { 固定摊销: perUnit },
      notes: sales > 0 ? [`¥${fixed}/月 ÷ ${sales} 件`] : ["未填月销量，固定成本未摊销"],
    };
  },
  roleVariants: {
    leadership: { label: "固定成本（看盈亏平衡）" },
  },
};

/** 自定义：兜底模块，放不属于以上类别的费用。 */
const customModule: CostModuleDef = {
  id: "custom",
  label: "自定义",
  icon: "✨",
  category: "custom",
  description: "不属于以上类别的其它成本",
  fields: fields(
    num("customCost", "自定义成本", "元/件", 0),
    { key: "customLabel", label: "名称", unit: "", type: "number", defaultValue: "" }
  ),
  calculate: (values) => {
    const cost = values.customCost || 0;
    return { cost, breakdown: { 自定义: cost }, notes: [] };
  },
};

/** 10 个模块，顺序即 UI 展示顺序（交付文档表格的原始顺序）。 */
export const COST_MODULE_REGISTRY: Record<string, CostModuleDef> = {
  material: materialModule,
  formulation: formulationModule,
  manufacturing: manufacturingModule,
  encapsulation: encapsulationModule,
  packaging: packagingModule,
  logistics: logisticsModule,
  certification: certificationModule,
  channel: channelModule,
  overhead: overheadModule,
  custom: customModule,
};

export const COST_MODULE_LIST: CostModuleDef[] = Object.values(COST_MODULE_REGISTRY);

export function getCostModule(moduleId: string): CostModuleDef | undefined {
  return COST_MODULE_REGISTRY[moduleId];
}
