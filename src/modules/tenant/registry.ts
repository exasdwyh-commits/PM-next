/**
 * 租户配置包注册表。
 *
 * 用静态 import 而非运行时读文件：客户端组件（表单占位符等）也要能拿到配置，
 * 且打包时即可校验 JSON 结构。新增 pack = 在 packs/<id>/ 放文件 + 这里登记一行。
 */
import hfTenant from "../../../packs/health-food/tenant.json";
import hfCategories from "../../../packs/health-food/domain/categories.json";
import hfCategoryContent from "../../../packs/health-food/domain/category-content.json";
import hfCostTemplates from "../../../packs/health-food/domain/cost-templates.json";
import hfCompliance from "../../../packs/health-food/domain/compliance.json";
import hfSamples from "../../../packs/health-food/domain/samples.json";
import hfLexicon from "../../../packs/health-food/domain/lexicon.json";
import hfRegulatory from "../../../packs/health-food/domain/regulatory.json";
import hfClaims from "../../../packs/health-food/domain/claims.json";
import pfTenant from "../../../packs/pet-food/tenant.json";
import pfCategories from "../../../packs/pet-food/domain/categories.json";
import pfCategoryContent from "../../../packs/pet-food/domain/category-content.json";
import pfCostTemplates from "../../../packs/pet-food/domain/cost-templates.json";
import pfCompliance from "../../../packs/pet-food/domain/compliance.json";
import pfSamples from "../../../packs/pet-food/domain/samples.json";
import pfLexicon from "../../../packs/pet-food/domain/lexicon.json";
import pfRegulatory from "../../../packs/pet-food/domain/regulatory.json";
import pfClaims from "../../../packs/pet-food/domain/claims.json";
import type { TenantPack } from "./types";

export const TENANT_PACKS: Record<string, TenantPack> = {
  "health-food": {
    tenant: hfTenant,
    categories: hfCategories,
    categoryContent: hfCategoryContent,
    costTemplates: hfCostTemplates,
    compliance: hfCompliance,
    samples: hfSamples,
    lexicon: hfLexicon,
    regulatory: hfRegulatory,
    claims: hfClaims,
  },
  "pet-food": {
    tenant: pfTenant,
    categories: pfCategories,
    categoryContent: pfCategoryContent,
    costTemplates: pfCostTemplates,
    compliance: pfCompliance,
    samples: pfSamples,
    lexicon: pfLexicon,
    regulatory: pfRegulatory,
    claims: pfClaims,
  },
};
