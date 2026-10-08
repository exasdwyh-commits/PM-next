/**
 * 国际化 - P3-3 跨境食品英文双语
 * 4类专用，支持中英文切换
 */

export type Locale = "zh" | "en";

export interface I18nText {
  zh: string;
  en: string;
}

export const I18N: Record<string, I18nText> = {
  // 类别
  regular_food: { zh: "普通食品", en: "Regular Food" },
  health_food: { zh: "保健食品", en: "Health Food" },
  cross_border_food: { zh: "跨境食品", en: "Cross-border Food" },
  cosmetics: { zh: "化妆品", en: "Cosmetics" },

  // 模块
  material: { zh: "原料", en: "Material" },
  formulation: { zh: "配方", en: "Formulation" },
  manufacturing: { zh: "生产", en: "Manufacturing" },
  packaging: { zh: "包装", en: "Packaging" },
  logistics: { zh: "物流", en: "Logistics" },
  compliance: { zh: "合规", en: "Compliance" },
  channel: { zh: "渠道", en: "Channel" },

  // BOM
  bom_title: { zh: "BOM原料清单", en: "BOM List" },
  bom_import: { zh: "BOM导入", en: "BOM Import" },
  bom_total: { zh: "总成本", en: "Total Cost" },

  // 供应商
  supplier: { zh: "供应商", en: "Supplier" },
  supplier_quote: { zh: "供应商报价", en: "Supplier Quote" },
  lowest_price: { zh: "最低价", en: "Lowest Price" },
  recommended: { zh: "推荐", en: "Recommended" },

  // 合规
  compliance_checklist: { zh: "合规清单", en: "Compliance Checklist" },
  required: { zh: "必需", en: "Required" },
  optional: { zh: "可选", en: "Optional" },
  done: { zh: "已完成", en: "Done" },
  pending: { zh: "待办", en: "Pending" },

  // 成本
  total_cost: { zh: "总成本", en: "Total Cost" },
  retail_price: { zh: "建议零售价", en: "Retail Price" },
  profit_margin: { zh: "利润率", en: "Profit Margin" },

  // 操作
  save: { zh: "保存", en: "Save" },
  export: { zh: "导出", en: "Export" },
  compare: { zh: "对比", en: "Compare" },
  delete: { zh: "删除", en: "Delete" },
  edit: { zh: "编辑", en: "Edit" },
  add: { zh: "添加", en: "Add" },

  // 4类卖点
  selling_point_regular: { zh: "性价比突出，日常刚需，SC合规", en: "Cost-effective, daily necessity, SC certified" },
  selling_point_health: { zh: "蓝帽子备案，多酚功能，软糖口感", en: "Blue hat filing, polyphenol function, gummy taste" },
  selling_point_cross_border: { zh: "进口原料，跨境背书，保税仓直发", en: "Imported material, cross-border endorsement, bonded warehouse" },
  selling_point_cosmetics: { zh: "透明质酸保湿，烟酰胺美白，玻璃瓶质感", en: "Hyaluronic moisturizing, niacinamide whitening, glass bottle texture" },
};

export function t(key: string, locale: Locale = "zh"): string {
  const entry = I18N[key];
  if (!entry) return key;
  return entry[locale] || entry.zh;
}

export function getCategoryI18n(category: string, locale: Locale = "zh"): I18nText {
  return I18N[category] || { zh: category, en: category };
}

export const LOCALE_STORAGE_KEY = "cost_locale";

export function getLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY) as Locale;
    if (saved === "en" || saved === "zh") return saved;
  } catch {}
  return "zh";
}

export function setLocale(locale: Locale) {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}

export function isCrossBorderCategory(category: string): boolean {
  return category === "cross_border_food";
}

export function shouldShowBilingual(category: string): boolean {
  return isCrossBorderCategory(category);
}
