export interface TenantManifest {
  id: string;
  version: number;
  isReferenceTemplate?: boolean;
  company: { name: string; industry: string; locale: string };
  product: { description: string };
  defaults: { categoryName: string };
  ui: {
    productNamePlaceholder: string;
    formSpecPlaceholder: string;
    forbiddenItemsPlaceholder: string;
    workTitlePlaceholder: string;
    sellingPointsPlaceholder: string;
    revisionPlaceholders: {
      coreIdea: string; targetAudience: string; coreSellingPoints: string; targetChannels: string;
      priceExpectation: string; formSpec: string; forbiddenItems: string; targetCost: string;
    };
  };
}

export interface TenantPack {
  tenant: TenantManifest;
  categories: {
    targetMargin: Record<string, number>;
    /** 分类键 → 对外显示名。中文品类名只存在 packs/，不写进 src/（见 tenant-neutral-guard） */
    classifications: Record<string, string>;
  };
  lexicon: { forms: string[]; claims: string[]; ingredients: string[]; marketDefaultForms: string[] };
  claims: {
    healthClaimPattern: string;
    strongClaimPattern: string;
    biomarkerClaimPattern: string;
    messages: { highPriceRisk: string; biomarkerVeto: string };
  };
  regulatory: { identityPathItem: string };
}
