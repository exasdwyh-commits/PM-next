/**
 * Supplier Quote - 供应商报价管理
 * 4类专用，支持比价和自动填入成本
 */

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

// 4类专用供应商模板
export const SUPPLIER_TEMPLATES: Record<string, SupplierQuote[]> = {
  regular_food: [
    { id: "1", supplierName: "供应商A", productName: "小麦粉", unitPrice: 0.008, moq: 1000, leadTime: "7天", validity: "30天", category: "原料", createdAt: "2026-10-08" },
    { id: "2", supplierName: "供应商B", productName: "小麦粉", unitPrice: 0.0075, moq: 2000, leadTime: "10天", validity: "30天", category: "原料", createdAt: "2026-10-08", isSelected: true },
    { id: "3", supplierName: "供应商C", productName: "白砂糖", unitPrice: 0.012, moq: 500, leadTime: "5天", validity: "30天", category: "原料", createdAt: "2026-10-08" },
  ],
  health_food: [
    { id: "1", supplierName: "多酚原料厂A", productName: "多酚提取物", unitPrice: 8, moq: 10, leadTime: "15天", validity: "60天", category: "核心原料", createdAt: "2026-10-08", notes: "82%留存率验证" },
    { id: "2", supplierName: "多酚原料厂B", productName: "多酚提取物", unitPrice: 7.5, moq: 20, leadTime: "20天", validity: "60天", category: "核心原料", createdAt: "2026-10-08", isSelected: true },
    { id: "3", supplierName: "胶囊厂A", productName: "植物胶囊壳", unitPrice: 0.02, moq: 10000, leadTime: "10天", validity: "30天", category: "剂型", createdAt: "2026-10-08" },
  ],
  cross_border_food: [
    { id: "1", supplierName: "海外供应商A", productName: "进口乳粉", unitPrice: 0.15, moq: 500, leadTime: "30天", validity: "60天", category: "原料", isImported: true, createdAt: "2026-10-08" },
    { id: "2", supplierName: "海外供应商B", productName: "进口乳粉", unitPrice: 0.14, moq: 1000, leadTime: "45天", validity: "60天", category: "原料", isImported: true, createdAt: "2026-10-08", isSelected: true },
    { id: "3", supplierName: "清关代理A", productName: "清关服务", unitPrice: 0.8, moq: 1, leadTime: "3天", validity: "30天", category: "清关", createdAt: "2026-10-08" },
  ],
  cosmetics: [
    { id: "1", supplierName: "原料厂A", productName: "透明质酸钠", unitPrice: 8, moq: 5, leadTime: "10天", validity: "60天", category: "核心成分", createdAt: "2026-10-08" },
    { id: "2", supplierName: "原料厂B", productName: "透明质酸钠", unitPrice: 7.2, moq: 10, leadTime: "15天", validity: "60天", category: "核心成分", createdAt: "2026-10-08", isSelected: true },
    { id: "3", supplierName: "包材厂A", productName: "玻璃瓶", unitPrice: 5, moq: 1000, leadTime: "20天", validity: "30天", category: "包材", createdAt: "2026-10-08" },
    { id: "4", supplierName: "包材厂B", productName: "玻璃瓶", unitPrice: 4.5, moq: 2000, leadTime: "25天", validity: "30天", category: "包材", createdAt: "2026-10-08", isSelected: true },
  ],
};

export function getSupplierTemplate(category: string): SupplierQuote[] {
  return SUPPLIER_TEMPLATES[category] || SUPPLIER_TEMPLATES.regular_food;
}

export function calculateBomFromQuotes(quotes: SupplierQuote[]): number {
  // 从选中的报价计算BOM成本
  const selected = quotes.filter(q => q.isSelected);
  return selected.reduce((sum, q) => sum + q.unitPrice, 0);
}
