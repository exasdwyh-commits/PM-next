/**
 * BOM Import - 原料清单导入
 * 支持Excel/CSV导入，自动计算原料成本
 * 4类专用：普通食品、保健食品、跨境食品、化妆品
 */

export interface BomItem {
  id: string;
  name: string;
  spec?: string;
  supplier?: string;
  quantity: number; // 每件用量 g/ml/个
  unit: string; // g, mg, ml, 个
  unitPrice: number; // 单价 元/kg, 元/g 等
  cost: number; // 单件成本 = quantity * unitPrice
  category?: string;
  isImported?: boolean;
  importDutyRate?: number;
  notes?: string;
}

export interface BomImportResult {
  items: BomItem[];
  totalCost: number;
  totalImportedCost: number;
  totalDomesticCost: number;
  ingredientCount: number;
  warnings: string[];
}

export function calculateBomCost(items: BomItem[]): BomImportResult {
  let totalCost = 0;
  let totalImported = 0;
  let totalDomestic = 0;
  const warnings: string[] = [];

  const calculated = items.map(item => {
    const cost = item.quantity * item.unitPrice;
    totalCost += cost;
    if (item.isImported) totalImported += cost;
    else totalDomestic += cost;

    if (item.unitPrice === 0) warnings.push(`${item.name} 单价为0，请确认`);
    if (item.quantity === 0) warnings.push(`${item.name} 用量为0，请确认`);

    return { ...item, cost };
  });

  if (calculated.length === 0) warnings.push("BOM清单为空");
  if (calculated.length > 20) warnings.push("原料种类较多，建议检查是否可合并");

  return {
    items: calculated,
    totalCost,
    totalImportedCost: totalImported,
    totalDomesticCost: totalDomestic,
    ingredientCount: calculated.length,
    warnings,
  };
}

export function parseBomCsv(csvText: string): BomItem[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  
  const items: BomItem[] = [];
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;

    const [name, quantityStr, unitPriceStr, unit, supplier, spec] = cols;
    const quantity = Number(quantityStr) || 0;
    const unitPrice = Number(unitPriceStr) || 0;

    items.push({
      id: `bom-${i}`,
      name: name || `原料${i}`,
      spec,
      supplier,
      quantity,
      unit: unit || "g",
      unitPrice,
      cost: quantity * unitPrice,
    });
  }
  return items;
}

// 4类专用BOM模板
export const BOM_TEMPLATES: Record<string, BomItem[]> = {
  regular_food: [
    { id: "1", name: "小麦粉", quantity: 50, unit: "g", unitPrice: 0.008, cost: 0.4, category: "主原料" },
    { id: "2", name: "白砂糖", quantity: 15, unit: "g", unitPrice: 0.012, cost: 0.18, category: "辅料" },
    { id: "3", name: "植物油", quantity: 10, unit: "g", unitPrice: 0.02, cost: 0.2, category: "油脂" },
    { id: "4", name: "鸡蛋", quantity: 10, unit: "g", unitPrice: 0.02, cost: 0.2, category: "辅料" },
  ],
  health_food: [
    { id: "1", name: "多酚提取物", quantity: 0.5, unit: "g", unitPrice: 8, cost: 4, category: "核心原料", notes: "80度烘焙82%留存" },
    { id: "2", name: "低聚果糖", quantity: 3, unit: "g", unitPrice: 0.05, cost: 0.15, category: "辅料" },
    { id: "3", name: "果胶", quantity: 0.8, unit: "g", unitPrice: 0.2, cost: 0.16, category: "凝胶" },
    { id: "4", name: "天然香料", quantity: 0.1, unit: "g", unitPrice: 2, cost: 0.2, category: "调味" },
    { id: "5", name: "植物胶囊壳", quantity: 60, unit: "粒", unitPrice: 0.02, cost: 1.2, category: "剂型", isImported: false },
  ],
  cross_border_food: [
    { id: "1", name: "进口乳粉", quantity: 20, unit: "g", unitPrice: 0.15, cost: 3, category: "主原料", isImported: true, importDutyRate: 12 },
    { id: "2", name: "进口坚果", quantity: 15, unit: "g", unitPrice: 0.25, cost: 3.75, category: "主原料", isImported: true, importDutyRate: 12 },
    { id: "3", name: "国产燕麦", quantity: 10, unit: "g", unitPrice: 0.02, cost: 0.2, category: "辅料" },
    { id: "4", name: "进口包装", quantity: 1, unit: "个", unitPrice: 1.5, cost: 1.5, category: "包装", isImported: true },
  ],
  cosmetics: [
    { id: "1", name: "透明质酸钠", quantity: 0.5, unit: "g", unitPrice: 8, cost: 4, category: "核心成分", notes: "保湿" },
    { id: "2", name: "烟酰胺", quantity: 1, unit: "g", unitPrice: 3, cost: 3, category: "功效成分", notes: "美白" },
    { id: "3", name: "甘油", quantity: 5, unit: "g", unitPrice: 0.02, cost: 0.1, category: "保湿剂" },
    { id: "4", name: "纯化水", quantity: 40, unit: "g", unitPrice: 0.001, cost: 0.04, category: "溶剂" },
    { id: "5", name: "乳化剂", quantity: 2, unit: "g", unitPrice: 0.5, cost: 1, category: "乳化" },
    { id: "6", name: "防腐剂", quantity: 0.5, unit: "g", unitPrice: 1, cost: 0.5, category: "防腐" },
  ],
};

export function getBomTemplate(category: string): BomItem[] {
  return BOM_TEMPLATES[category] || BOM_TEMPLATES.regular_food;
}
