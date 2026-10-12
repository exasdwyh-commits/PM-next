/**
 * Supplier Quote - 供应商报价管理
 * 支持比价和自动填入成本；示例数据由租户 pack 提供（domain/samples.json）
 */

import { tenantSamples, defaultCategoryKey } from "@/modules/tenant";

export interface SupplierQuote {
  id: string;
  supplierName: string;
  contact?: string;
  productName: string;
  spec?: string;
  unitPrice: number;
  moq: number; // 最小起订量
  leadTime: string; // 交期
  validity: string; // 有效期
  category: string; // 原料/包材/加工等
  isImported?: boolean;
  notes?: string;
  createdAt: string;
  isSelected?: boolean;
}

export interface SupplierComparison {
  productName: string;
  quotes: SupplierQuote[];
  lowestPrice: number;
  highestPrice: number;
  avgPrice: number;
  recommended?: SupplierQuote;
  savings?: number; // 选最低价可节省
}

export function compareSupplierQuotes(quotes: SupplierQuote[]): SupplierComparison | null {
  if (quotes.length === 0) return null;

  const prices = quotes.map(q => q.unitPrice);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  // 推荐：最低价且MOQ合理
  const sorted = [...quotes].sort((a, b) => {
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
    return a.moq - b.moq; // 同价选MOQ小的
  });
  const recommended = sorted[0];
  const savings = highestPrice - lowestPrice;

  return {
    productName: quotes[0].productName,
    quotes,
    lowestPrice,
    highestPrice,
    avgPrice,
    recommended,
    savings,
  };
}

export function groupQuotesByProduct(quotes: SupplierQuote[]): Record<string, SupplierComparison> {
  const grouped: Record<string, SupplierQuote[]> = {};
  for (const quote of quotes) {
    if (!grouped[quote.productName]) grouped[quote.productName] = [];
    grouped[quote.productName].push(quote);
  }

  const result: Record<string, SupplierComparison> = {};
  for (const [productName, productQuotes] of Object.entries(grouped)) {
    const comparison = compareSupplierQuotes(productQuotes);
    if (comparison) result[productName] = comparison;
  }
  return result;
}

/**
 * 取某品类的示例供应商报价。
 * 数据来自 pack 的 `domain/samples.json`；未命中该品类时落 pack 的兜底品类。
 * **不在 src/ 内写死示例数据**（见 tests/tenant-neutral-guard.test.ts）。
 */
export function getSupplierTemplate(category: string): SupplierQuote[] {
  const all = tenantSamples().supplierTemplates ?? {};
  return all[category] ?? all[defaultCategoryKey()] ?? [];
}

export function calculateBomFromQuotes(quotes: SupplierQuote[]): number {
  // 从选中的报价计算BOM成本
  const selected = quotes.filter(q => q.isSelected);
  return selected.reduce((sum, q) => sum + q.unitPrice, 0);
}
