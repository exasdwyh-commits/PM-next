/**
 * Modular Cost Engine - Module Types
 * ===================================
 * 每个产品成本结构不同，需要模块化
 * 
 * 例如：
 * - 食品：原料 + 配方损耗 + 加工 + 包装 + 物流 + 渠道
 * - 保健品：原料 + 配方 + 胶囊/压片 + 检测 + 包装 + 物流
 * - 电子：元器件 + 组装 + 测试 + 包装 + 物流
 * - 服装：面料 + 辅料 + 裁剪缝制 + 质检 + 包装
 */

export type CostModuleCategory = 
  | "material"      // 原料/材料
  | "formulation"   // 配方/工艺
  | "manufacturing" // 制造/加工
  | "packaging"     // 包装
  | "logistics"     // 物流仓储
  | "channel"       // 渠道费用
  | "certification" // 认证检测
  | "overhead"      // 固定成本
  | "custom";       // 自定义

export interface CostField {
  key: string;
  label: string;
  unit: string; // 元/件, %, 元/月 等
  type: "number" | "percent" | "select";
  required?: boolean;
  defaultValue?: number | string;
  hint?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: string;
}

export interface CostModuleDef {
  id: string;
  label: string;
  icon: string;
  category: CostModuleCategory;
  description: string;
  fields: CostField[];
  // 计算逻辑：输入字段值，输出成本
  calculate: (values: Record<string, any>, context?: any) => {
    cost: number;
    breakdown?: Record<string, number>;
    notes?: string[];
  };
  // 角色化：不同角色看到的不同
  roleVariants?: {
    leadership?: { hidden?: boolean; label?: string };
    sales?: { label?: string; desc?: string; hidden?: boolean };
  };
}

export interface CostModuleInstance {
  moduleId: string;
  enabled: boolean;
  values: Record<string, number | string>;
  // 覆盖默认
  customLabel?: string;
}

export interface ProductCostTemplate {
  id: string;
  name: string;
  description: string;
  category: string; // 食品, 保健品, 电子, 服装 等
  icon: string;
  modules: CostModuleInstance[];
  // 默认渠道、快递等
  defaults?: {
    channel?: string;
    expressType?: string;
    invoiceType?: string;
  };
}

export interface ModularCostResult {
  // 按模块的成本
  modules: {
    moduleId: string;
    label: string;
    icon: string;
    cost: number;
    breakdown?: Record<string, number>;
    notes?: string[];
    values?: Record<string, number | string>;
  }[];
  // 汇总
  totalMaterialCost: number;
  totalManufacturingCost: number;
  totalPackagingCost: number;
  totalLogisticsCost: number;
  totalChannelCost: number;
  totalComplianceCost: number;
  totalOverhead: number;
  totalCost: number;
  // 分项成本明细（HTML / Office 报告直接消费）
  breakdown: {
    totalMaterial: number;
    totalManufacturing: number;
    totalPackaging: number;
    totalLogistics: number;
    totalChannel: number;
    totalCompliance: number;
    totalCost: number;
  };
  // 风险提示（HTML / Office 报告直接消费）
  warnings: string[];
  // 兼容旧引擎
  layer1Material: number;
  layer2Packaging: number;
  layer3Manufacturing: number;
  layer4Freight: number;
  layer5Channel: number;
  layer6Allocation: number;
  // 利润
  retailPrice: number;
  netProfit: number;
  netMarginRate: number;
  breakevenUnits: number;
  // 供货价
  supplyPriceFloor: number;
  supplyPriceSuggested: number;
}
