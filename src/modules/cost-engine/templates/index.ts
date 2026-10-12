/**
 * Product Cost Templates —— 租户 pack 驱动。
 *
 * 模板数据（品类 → 各成本模块的默认值）在 `packs/<id>/domain/cost-templates.json`；
 * 显示名从 `categories.classifications` 读，图标从 `category-content` 读。
 * `src/` 不含任何品类名或行业词（见 tests/tenant-neutral-guard.test.ts）。
 *
 * 换租户 = 换 pack，本文件一行不改。
 */
import type { ProductCostTemplate } from "../modules/types";
import { tenantCostTemplates, categoryName, categoryMeta } from "@/modules/tenant";

/** 自定义模板：无行业词，属内核通用能力（不随租户变化），保留在内核。 */
export const CUSTOM_TEMPLATE: ProductCostTemplate = {
  id: "custom",
  name: "自定义",
  description: "自定义成本结构，自选模块",
  category: "自定义",
  icon: "✨",
  modules: [
    { moduleId: "material", enabled: true, values: {} },
    { moduleId: "packaging", enabled: true, values: {} },
    { moduleId: "logistics", enabled: true, values: {} },
    { moduleId: "channel", enabled: true, values: { retailPrice: 99 } },
    { moduleId: "custom", enabled: false, values: {} },
  ],
};

/** 由 pack 数据构造一个成本模板（显示名 / 图标来自 pack，不写死）。 */
function buildTemplate(key: string): ProductCostTemplate {
  const t = tenantCostTemplates().templates[key];
  const name = categoryName(key);
  return {
    id: key,
    name,
    description: t?.description ?? "",
    category: name,
    icon: categoryMeta(key).icon,
    certificationToCompliance: t?.certificationToCompliance === true,
    modules: (t?.modules ?? []).map((m) => ({
      moduleId: m.moduleId,
      enabled: m.enabled,
      values: { ...m.values },
    })),
    defaults: t?.defaults,
  };
}

/**
 * 当前 pack 的全部品类模板（含内核的自定义模板）。
 * 模块求值时构建一次 —— pack 是静态配置，键集在进程内不变。
 */
export const COST_TEMPLATES: Record<string, ProductCostTemplate> = (() => {
  const out: Record<string, ProductCostTemplate> = {};
  for (const key of Object.keys(tenantCostTemplates().templates)) out[key] = buildTemplate(key);
  out.custom = CUSTOM_TEMPLATE;
  return out;
})();

export function getTemplate(id: string): ProductCostTemplate | null {
  return COST_TEMPLATES[id] || null;
}

export function listTemplates(): ProductCostTemplate[] {
  return Object.values(COST_TEMPLATES);
}

/**
 * 按产品名 / 品类文本选择模板。
 *
 * 关键词与优先级来自 pack 的 `productClassifyKeywords`（越靠前越优先），
 * 无命中时落 pack 的 `defaultTemplateKey`。
 * **src/ 不写死任何行业关键词或默认品类。**
 */
export function getTemplateForProduct(productName?: string, category?: string): ProductCostTemplate {
  const text = `${productName || ""} ${category || ""}`.toLowerCase();
  const cfg = tenantCostTemplates();
  for (const { key, keywords } of cfg.productClassifyKeywords) {
    if (keywords.some((w) => w && text.includes(w.toLowerCase()))) {
      return COST_TEMPLATES[key] ?? buildTemplate(cfg.defaultTemplateKey);
    }
  }
  return COST_TEMPLATES[cfg.defaultTemplateKey] ?? CUSTOM_TEMPLATE;
}
