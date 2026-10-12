/**
 * 国际化 —— 品类名与卖点由租户 pack 提供。
 *
 * 内核只保留无行业词的通用词条（模块 / BOM / 供应商 / 合规 / 成本 / 操作）。
 * 品类名的中英文都从 pack 读（`classifications` / `classificationsEn`），
 * `src/` 不留任何品类文案副本（见 tests/tenant-neutral-guard.test.ts）。
 * 卖点见 `categoryContent().selling`，不在本表重复。
 */
import { categoryName, getTenantPack } from "@/modules/tenant";

export type Locale = "zh" | "en";

export interface I18nText {
  zh: string;
  en: string;
}

/** 内核通用词条（无行业词）。品类名与卖点走 pack，不在其中。 */
export const I18N: Record<string, I18nText> = {
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
};

/** 品类的英文名（pack 提供；缺失返回 undefined，由调用方决定兜底）。 */
function categoryEn(key: string): string | undefined {
  return getTenantPack().categories.classificationsEn?.[key];
}

export function t(key: string, locale: Locale = "zh"): string {
  const entry = I18N[key];
  if (entry) return entry[locale] || entry.zh;
  // 品类键：中文名从 pack 的 classifications 读，英文名从 classificationsEn 读
  if (locale === "en") return categoryEn(key) ?? key;
  return categoryName(key);
}

export function getCategoryI18n(category: string, _locale: Locale = "zh"): I18nText {
  return { zh: categoryName(category), en: categoryEn(category) ?? category };
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

/** 该品类是否需要中英双语展示，由 pack 的 `bilingualKeys` 决定。 */
export function shouldShowBilingual(category: string): boolean {
  return (getTenantPack().categories.bilingualKeys ?? []).includes(category);
}
