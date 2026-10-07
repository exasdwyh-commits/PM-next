/**
 * 租户配置包注册表。
 *
 * 用静态 import 而非运行时读文件：客户端组件（表单占位符等）也要能拿到配置，
 * 且打包时即可校验 JSON 结构。新增 pack = 在 packs/<id>/ 放文件 + 这里登记一行。
 */
import hfTenant from "../../../packs/health-food/tenant.json";
import hfCategories from "../../../packs/health-food/domain/categories.json";
import hfLexicon from "../../../packs/health-food/domain/lexicon.json";
import hfRegulatory from "../../../packs/health-food/domain/regulatory.json";
import hfClaims from "../../../packs/health-food/domain/claims.json";
import type { TenantPack } from "./types";

export const TENANT_PACKS: Record<string, TenantPack> = {
  "health-food": {
    tenant: hfTenant,
    categories: hfCategories,
    lexicon: hfLexicon,
    regulatory: hfRegulatory,
    claims: hfClaims,
  },
};
