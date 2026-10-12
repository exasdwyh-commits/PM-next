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
    /**
     * 示例数据：表单占位符里「例如：…」后面那个**具体的值**。
     *
     * 与 placeholders 的语义区别：placeholders 是**引导语**（告诉用户该填什么，
     * 本身往往已含行业词，属租户定制）；examples 是**示例值**（一个具体样例，
     * 换租户必须换）。两者都属租户配置，都只能存在于 packs/。
     *
     * 可选：pack 未提供时组件不应回退到写死的示例（那会把行业词带回 src/），
     * 而是降级成不带示例的纯引导语。
     */
    examples?: {
      /** 成本方案名称示例。 */
      scenarioName?: string;
      /** 审批说明示例。 */
      approvalComment?: string;
    };
  };
}

export interface TenantPack {
  tenant: TenantManifest;
  categories: {
    targetMargin: Record<string, number>;
    /** 分类键 → 对外显示名。中文品类名只存在 packs/，不写进 src/（见 tenant-neutral-guard） */
    classifications: Record<string, string>;
    /** 分类键 → 英文显示名。供 i18n 双语展示；缺失时 UI 退回分类键，不外泄行业词。 */
    classificationsEn?: Record<string, string>;
    /** 需要中英双语展示的分类键（如跨境品类）。空/缺省表示不展示双语。 */
    bilingualKeys?: string[];
    /** 合规类别枚举（用于产品参数契约的合规类别字段）。 */
    complianceCategories?: string[];
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
  /** 按品类的成本模板（见 domain/cost-templates.json）。 */
  costTemplates: TenantCostTemplates;
  /** 按品类的合规清单（见 domain/compliance.json）。 */
  compliance: TenantComplianceChecklists;
  /** 成本引擎的示例输入数据（BOM / 供应商报价样例，见 domain/samples.json）。 */
  samples: TenantSamples;
}

/**
 * 单个品类的内容。字段与 UI 呈现一一对应，取值即迁移前各组件内嵌的字面量，
 * 故读取方改造后行为零变化。
 */
export interface CategoryContent {
  /** 品类图标（表现层，但**按租户绑定**：不同行业的图标集不同，故随 pack 走）。 */
  icon: string;
  /** 主色。 */
  color: string;
  /** 投影，由 color 派生（`0 8px 24px rgba(r,g,b,.15)`）。 */
  shadow: string;
  /** 默认（ui 套）渐变。 */
  gradient: string;
  /**
   * 三套并存的配色方案：ui（卡片/面板）、report（报告页）、deep（图表柱体）。
   * 它们是**有意的视觉分层**，不是历史漂移，故并存而非统一。
   * 值为完整 CSS `linear-gradient(...)` 字符串。
   */
  tints: Record<string, string>;
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
  /**
   * 把自由文本（产品名 / 宣称）**归入本品类**的关键词。
   *
   * 背景：内核原先在组件里写死了「文本含哪些关键词就归入哪个品类」的启发式表，
   * 那是语义级租户假设——换租户后模型会带着旧行业的判断去分类。下沉到此，
   * 匹配顺序由 `categoryKeys()` 逆序决定（pack 中越靠后定义的品类越具体，优先匹配）。
   *
   * 空数组表示「不作正向匹配」，只作为兜底品类（配合 `defaultKey`）。
   */
  classifyKeywords?: string[];
  /**
   * 成本报告的逐品类文案。
   *
   * 背景：`cost-engine/html-report*.ts` 原先用 `category === "..."` 三元表达式写死了
   * 「按品类的报告结论 / 核心卖点 / 头部摘要 / 风险项」，换 pack 后报告仍写旧行业内容。
   * 下沉到此，报告只读 pack；字段缺失时退回中性兜底（不含任何行业词）。
   */
  report?: {
    /** 按 role 的报告结论句。 */
    conclusion?: { leadership?: string; product?: string; sales?: string };
    /** 销售区「核心卖点」一句。 */
    corePitch?: string;
    /** 报告头部摘要句。 */
    headerNote?: string;
    /** 风险项短语。 */
    riskNote?: string;
    /** 一句话结论的尾巴（不含数值）。 */
    summary?: string;
    /** 成本构成特征短语（如「含关税和国际物流」）。 */
    costFeature?: string;
  };
}

/**
 * 品类内容映射。值类型放宽到含 string —— pack JSON 里允许写 `_note` 这类元注释键，
 * `categoryContent()` 读取时会剔除 `_` 前缀的键与非对象值。
 *
 * 另有 `defaultKey`：未指定品类时的兜底键。**每个 pack 自己的**——原先
 * `category-meta.ts` 把兜底键写死成 `health_food`，建第二个 pack 时实测发现
 * 那是结构性租户假设：它不含任何行业词，词表守卫抓不到，但换租户必然要改 src/。
 */
export type CategoryContentMap = Record<string, CategoryContent | string | undefined>;

/**
 * 单个品类的成本模板（成本引擎专属数据）。
 *
 * 与 `CategoryContent` 的区别：后者是**呈现层内容**（卖点/文案/配色），
 * 本类型是**成本引擎的模块默认值**（原料/生产/包装/物流/渠道的默认参数）。
 * 两者的载体不同，读取方也不同，不得合并。
 *
 * 显示名 / 图标 / 卖点不在此重复，由 categories + category-content 提供。
 */
export interface TenantCostTemplate {
  description: string;
  /**
   * 该品类的认证/检测成本是否计入「合规」（而非「制造」）。
   * 由 pack 按品类表达：检测与备案强绑定的品类（须逐位沿用旧行为），其余算常规出厂检验归制造。
   * 此前 src 里用品类**显示名**硬判断，换 pack 后恒为 false —— 属行为级租户假设。
   */
  certificationToCompliance?: boolean;
  modules: { moduleId: string; enabled: boolean; values: Record<string, number | string | undefined> }[];
  defaults?: { channel?: string; expressType?: string; invoiceType?: string };
}

/** 单个成本字段的 pack 覆盖（按 moduleId.fieldKey 定位）。仅覆盖列出的键。 */
export interface TenantCostFieldOverride {
  label?: string;
  hint?: string;
  defaultValue?: number | string;
  options?: { value: string; label: string }[];
}

/**
 * 合规费用的阈值提示（逐品类的业务知识）。
 * key = `complianceType` 的值；`minFilingFee` 省略表示无条件提示。
 */
export interface TenantComplianceNote {
  minFilingFee?: number;
  note: string;
}

export interface TenantCostTemplates {
  /** 未指定品类时的兜底模板键。**每个 pack 自己的**。 */
  defaultTemplateKey: string;
  templates: Record<string, TenantCostTemplate>;
  /**
   * 把自由文本（产品名 / 品类）归入某成本模板的关键词，**按优先级排列**：
   * 越靠前越优先匹配。替代原先写死在 `templates/index.ts` 的分类启发式。
   */
  productClassifyKeywords: { key: string; keywords: string[] }[];
  /**
   * 成本模块字段元数据的租户覆盖：`moduleFieldOverrides[moduleId][fieldKey]`。
   *
   * 动机：像 `complianceType`（合规类型）/ `capsuleType`（剂型）这类 select 的
   * **选项值集本身就是行业特定的** —— 换了租户，选项完全不同，若写死在
   * `cost-engine/modules/registry.ts` 会让第二个 pack 的下拉框仍显示旧行业选项。
   * 字段的**结构**（key/unit/type）仍留在内核，只有租户相关的文案与选项走 pack。
   */
  moduleFieldOverrides?: Record<string, Record<string, TenantCostFieldOverride>>;
  /** 按合规类型给的费用阈值提示，见 `TenantComplianceNote`。 */
  complianceNotes?: Record<string, TenantComplianceNote>;
}

/** 单个合规项。与 `cost-engine/compliance-checklist.ts` 的 `ComplianceItem` 同构。 */
export interface TenantComplianceItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  category: string;
  estimatedCost?: number;
  estimatedDays?: number;
}

/** 按品类的合规清单（见 domain/compliance.json）。 */
export interface TenantComplianceChecklists {
  checklists: Record<string, TenantComplianceItem[]>;
}

/** BOM 示例项（与 `cost-engine/bom-import.ts` 的 `BomItem` 同构）。 */
export interface TenantBomSample {
  id: string;
  name: string;
  spec?: string;
  supplier?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  cost: number;
  category?: string;
  isImported?: boolean;
  importDutyRate?: number;
  notes?: string;
}

/** 供应商报价示例项（与 `cost-engine/supplier-quote.ts` 的 `SupplierQuote` 同构）。 */
export interface TenantSupplierSample {
  id: string;
  supplierName: string;
  contact?: string;
  productName: string;
  spec?: string;
  unitPrice: number;
  moq: number;
  leadTime: string;
  validity: string;
  category: string;
  isImported?: boolean;
  notes?: string;
  createdAt: string;
  isSelected?: boolean;
}

/** 成本引擎的示例输入数据（见 domain/samples.json）。 */
export interface TenantSamples {
  /** 演示用的示例产品名（无真实数据时的兜底展示）。 */
  demoProductName?: string;
  bomTemplates?: Record<string, TenantBomSample[]>;
  supplierTemplates?: Record<string, TenantSupplierSample[]>;
}
