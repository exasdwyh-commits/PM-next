/**
 * BOM Import - 原料清单导入
 * 支持Excel/CSV导入，自动计算原料成本
 * 示例数据由租户 pack 提供（domain/samples.json）
 */

import { tenantSamples, defaultCategoryKey } from "@/modules/tenant";

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

/**
 * 取某品类的示例 BOM 清单。
 * 数据来自 pack 的 `domain/samples.json`；未命中该品类时落 pack 的兜底品类。
 * **不在 src/ 内写死示例数据**（见 tests/tenant-neutral-guard.test.ts）。
 */
export function getBomTemplate(category: string): BomItem[] {
  const all = tenantSamples().bomTemplates ?? {};
  return all[category] ?? all[defaultCategoryKey()] ?? [];
}
