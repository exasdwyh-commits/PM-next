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
  /** 按品类的营销与合规内容（见 domain/category-content.json）。 */
  categoryContent: CategoryContentMap;
}

/**
 * 单个品类的内容。字段与 UI 呈现一一对应，取值即迁移前各组件内嵌的字面量，
 * 故读取方改造后行为零变化。
 */
export interface CategoryContent {
  /** 完整卖点集。卡片区若只展示前 N 条，由读取方显式 slice，避免另存短版。 */
  selling: string[];
  /** 零售价展示值。 */
  price: string;
  /** 成本数值（用于占比等计算场景）。与 costBreakdown 是两个不同性质的东西，不可合并。 */
  costSummary: string;
  /** 成本构成明细（含零售价回算），直接展示用。 */
  costBreakdown: string;
  /** 成本结构说明（给成本计算器用的整段文字）。 */
  costNotes: string;
  /** 配方描述。 */
  formula: string;
  /**
   * 合规措辞三档。此前散在 3 个文件、3 种写法，长度与用途不同；
   * 强行统一会让某一处显示发生变化，故按用途分档保留各自原措辞。
   */
  compliance: { short: string; summary: string; requirements: string };
  /** 合规简称，用于 UI 内联短语（如「蓝帽子合规可作为卖点」）。 */
  complianceShortName: string;
  /** 销售话术里的卖点句。 */
  salesPitch: string;
  /** 该品类推荐的工具卡片。 */
  tools: { id: string; label: string; icon: string; desc: string }[];
}

/**
 * 品类内容映射。值类型放宽到含 string —— pack JSON 里允许写 `_note` 这类元注释键，
 * `categoryContent()` 读取时会剔除 `_` 前缀的键与非对象值。
 */
export type CategoryContentMap = Record<string, CategoryContent | string | undefined>;
