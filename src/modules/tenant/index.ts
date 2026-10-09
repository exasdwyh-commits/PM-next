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
  DEFAULT_CATEGORY,
} from "./category-meta";
export type { CategoryKey, CategoryMeta } from "./category-meta";
