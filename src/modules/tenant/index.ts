/**
 * Kern 租户配置包（Tenant Pack）入口。
 *
 * 内核保持行业中立；所有行业知识（品类毛利、剂型/宣称/成分词表、法规清单、
 * 公司描述与表单示例）都从当前 pack 读取。部署时用
 * NEXT_PUBLIC_KERN_TENANT_PACK 选择 pack，默认 health-food（标准参考模版）。
 */
import { TENANT_PACKS } from "./registry";
import type { TenantPack } from "./types";

export type { TenantPack, TenantManifest } from "./types";

export const DEFAULT_TENANT_PACK_ID = "health-food";

export function resolveTenantPackId(): string {
  const raw = (process.env.NEXT_PUBLIC_KERN_TENANT_PACK ?? "").trim();
  return raw || DEFAULT_TENANT_PACK_ID;
}

export function getTenantPack(id: string = resolveTenantPackId()): TenantPack {
  const pack = TENANT_PACKS[id];
  if (!pack) {
    throw new Error(
      `未知的租户配置包 "${id}"。可用：${Object.keys(TENANT_PACKS).join(", ")}`,
    );
  }
  return pack;
}

export function listTenantPacks(): string[] {
  return Object.keys(TENANT_PACKS);
}

/**
 * 当前 pack 的 UI 示例数据（表单占位符里「例如：…」后面的具体值）。
 *
 * 组件用法：`const ex = tenantExamples(); placeholder={ex.scenarioName ? `方案名称，例如：${ex.scenarioName}` : "方案名称"}`
 * —— **不要**在组件里写死兜底示例，那会把行业词带回 src/（见 tenant-neutral-guard）。
 */
export function tenantExamples(): NonNullable<TenantPack["tenant"]["ui"]["examples"]> {
  return getTenantPack().tenant.ui.examples ?? {};
}

/**
 * 当前 pack 的成本模板（成本引擎专属数据）。
 * 读取方：`cost-engine/templates`。**不在 src/ 内写死任何品类模板**。
 */
export function tenantCostTemplates(): TenantPack["costTemplates"] {
  return getTenantPack().costTemplates;
}

/**
 * 当前 pack 的合规清单（按品类）。
 * 读取方：`cost-engine/compliance-checklist`。**不在 src/ 内写死任何品类清单**。
 */
export function tenantCompliance(): TenantPack["compliance"] {
  return getTenantPack().compliance;
}

/**
 * 当前 pack 的成本引擎示例数据（BOM 清单 / 供应商报价样例，按品类）。
 * 读取方：`cost-engine/bom-import` / `cost-engine/supplier-quote`。**不在 src/ 内写死示例**。
 */
export function tenantSamples(): TenantPack["samples"] {
  return getTenantPack().samples;
}

/**
 * 品类外观元数据从本入口再导出，使组件只需 `import { categoryMeta } from "@/modules/tenant"`。
 *
 * 注意：category-meta.ts 反向 import 本文件的 getTenantPack，形成循环依赖。
 * 之所以安全：getTenantPack 是**函数声明**，模块间绑定会被 hoist，
 * 循环中不产生 TDZ；而 categoryMeta() 只在**调用时**才读 pack，不在模块求值期读。
 * 改动此处时请保留这一性质（不要把 getTenantPack 改成 const 箭头函数）。
 */
export {
  categoryMeta,
  categoryName,
  categoryKeys,
  categoryContent,
  defaultCategoryKey,
  classifyCategoryByText,
  matchCategoryByText,
} from "./category-meta";
export type { CategoryKey, CategoryMeta, TintPreset } from "./category-meta";
export type { CategoryContent, CategoryContentMap, TenantCostTemplate, TenantCostTemplates, TenantComplianceItem, TenantComplianceChecklists } from "./types";
