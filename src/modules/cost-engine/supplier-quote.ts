/**
 * 供应商报价（本地补齐）
 * ----------------------
 * Arena 工作区未交付本文件（cost-export.tsx 从它取 `SupplierQuote` 类型）。
 * 字段按调用点固定：productName / supplierName / unitPrice / moq / leadTime。
 * 比价能力按 MASTER_PLAN_4CAT.md「供应商：添加表单+分组比价+最低最高均价+节省+推荐+选用+MOQ交期」
 * 实现。
 */

export interface SupplierQuote {
  /** 物料/产品名，比价按它分组 */
  productName: string;
  supplierName: string;
  /** 单价（元/单位） */
  unitPrice: number;
  /** 最小起订量 */
  moq: number;
  /** 交期（天） */
  leadTime: number;
  /** 资质备注，如「SC / 蓝帽子 / 进口备案」 */
  qualification?: string;
  /** 质量评分 0–100，用于综合推荐 */
  qualityScore?: number;
  /** 是否被选用 */
  selected?: boolean;
}

export interface QuoteComparison {
  productName: string;
  count: number;
  min: SupplierQuote;
  max: SupplierQuote;
  avgUnitPrice: number;
  /** 相对最高价的节省比例（%），用于话术「换成 X 可省 Y%」 */
  savingRate: number;
  /** 综合推荐：价格 50% + 交期 25% + 质量 25% 打分最高者 */
  recommended: SupplierQuote;
  quotes: SupplierQuote[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 综合得分：价格越低越好，交期越短越好，质量分越高越好。 */
function score(quote: SupplierQuote, cheapest: number, fastest: number): number {
  const priceScore = quote.unitPrice > 0 ? cheapest / quote.unitPrice : 0;
  const leadScore = quote.leadTime > 0 ? fastest / quote.leadTime : 1;
  const qualityScore = (quote.qualityScore ?? 60) / 100;
  return priceScore * 0.5 + leadScore * 0.25 + qualityScore * 0.25;
}

/** 按物料名分组比价。 */
export function compareSupplierQuotes(quotes: SupplierQuote[]): QuoteComparison[] {
  const groups = new Map<string, SupplierQuote[]>();
  for (const q of quotes) {
    const key = q.productName || "未命名";
    const list = groups.get(key) || [];
    list.push(q);
    groups.set(key, list);
  }

  return Array.from(groups.entries()).map(([productName, list]) => {
    const sortedByPrice = [...list].sort((a, b) => a.unitPrice - b.unitPrice);
    const min = sortedByPrice[0];
    const max = sortedByPrice[sortedByPrice.length - 1];
    const avgUnitPrice = round2(list.reduce((s, q) => s + (q.unitPrice || 0), 0) / list.length);
    const fastest = Math.min(...list.map((q) => q.leadTime || Number.POSITIVE_INFINITY));

    const recommended = [...list].sort(
      (a, b) => score(b, min.unitPrice, fastest) - score(a, min.unitPrice, fastest)
    )[0];

    return {
      productName,
      count: list.length,
      min,
      max,
      avgUnitPrice,
      savingRate: max.unitPrice > 0 ? round2(((max.unitPrice - min.unitPrice) / max.unitPrice) * 100) : 0,
      recommended,
      quotes: list,
    };
  });
}

/** 生成可直接给销售用的比价话术。 */
export function buildQuoteScript(comparison: QuoteComparison): string {
  if (comparison.count < 2) {
    return `${comparison.productName} 目前只有 1 家报价（${comparison.min.supplierName} ¥${comparison.min.unitPrice}，MOQ ${comparison.min.moq}，${comparison.min.leadTime} 天），建议再询 2 家以形成比价。`;
  }
  return `${comparison.productName} 共 ${comparison.count} 家报价：最低 ¥${comparison.min.unitPrice}（${comparison.min.supplierName}），最高 ¥${comparison.max.unitPrice}（${comparison.max.supplierName}），均价 ¥${comparison.avgUnitPrice}。改用推荐供应商可省约 ${comparison.savingRate}%；推荐 ${comparison.recommended.supplierName}（¥${comparison.recommended.unitPrice}，MOQ ${comparison.recommended.moq}，${comparison.recommended.leadTime} 天）。`;
}
