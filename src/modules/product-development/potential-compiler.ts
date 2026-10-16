/**
 * Evidence → Product Potential Compiler（P0-1 / P0-2 / P0-4）
 *
 * 为什么需要这一层：
 * 在此之前 `assessProductPotential()` 的 `dimensions` 只能由调用方（人 / 模型 / Agent）
 * 在 HTTP body 里手填，研究证据链（ResearchRun → EvidenceSourceCapture → Evidence →
 * EvidenceClaim）与潜力评估之间**没有任何连接代码**。后果有三个：
 *   1. 正式评分无法回溯到 source，只能依赖调用方自己填的 sourceRefs 字符串；
 *   2. 模板推断值（如 `price × 0.22` 的目标成本）与真实证据在类型上没有区别，
 *      存在被当成「市场事实」的风险；
 *   3. 资料缺失时容易凭感觉给分，而不是承认 UNKNOWN。
 *
 * 本模块做三件事，全部是**纯函数**（不查库、不调模型、不抓网页）：
 *   A. 证据防火墙：把每条 evidence / claim 归入 FACT / SUPPORTED_INFERENCE / HYPOTHESIS /
 *      TEMPLATE_ASSUMPTION / UNKNOWN 五类。模板推断**在类型上**就不可能升成 FACT，
 *      因此也不可能进入 verifiedCoverageRatio。
 *   B. 维度 rubric 打分：每个维度按「必需事实的覆盖数」确定性给分，不由模型自由发挥；
 *      覆盖不足即 `score = null` + `UNKNOWN`，不用 0 分冒充未知。
 *   C. 证据缺口与停止条件：产出可执行的 `EvidenceGap[]`（含 priority / canAutoResearch /
 *      requiresHumanInput），并给出 Gap → Research → Rescore 循环何时该停的确定性判定。
 *
 * 边界（重要）：
 * - 本模块**只产出** `ProductPotentialInput`。正式判定（硬门槛优先、覆盖率、verdict）
 *   的唯一实现仍然是 `assessProductPotential()`，这里不复制第二套 verdict 逻辑。
 * - 本模块**不做**任何金额推算。UNIT_ECONOMICS 的毛利只能由 `grossMarginScore()`
 *   用确定性代码算，且必须同时拿到工厂报价与零售价的事实级证据。
 * - 本模块**不发明市场数字**。缺证据就是缺证据，产出的是 gap 而不是默认值。
 */

import {
  type PotentialDimensionInput,
  type PotentialDimensionKey,
  type PotentialEvidenceState,
  type PotentialGateInput,
  type ProductPotentialInput,
  type ProductPotentialAssessment,
} from "./potential-assessment";
import { grossMarginScore, parseAmount } from "./scoring";

// ---------------------------------------------------------------------------
// A. 证据防火墙
// ---------------------------------------------------------------------------

/**
 * 进入正式评分前，每条证据必须先归类。五类的语义边界：
 *
 * - `FACT`                 已核实（REAL + VERIFIED）且断言类型为 FACT —— 唯一可进 VERIFIED 的来源。
 * - `SUPPORTED_INFERENCE`  已核实证据上的推断断言（VERIFIED + INFERENCE）—— 可进 SUPPORTED。
 * - `HYPOTHESIS`           未核实材料、或已核实证据上的假设断言 —— 至多 ASSUMED。
 * - `TEMPLATE_ASSUMPTION`  规则模板 / 演示数据（nature=DEMO）—— **不得产生分数**。
 * - `UNKNOWN`              被否决的证据，或没有证据 —— 保持未知。
 */
export type EvidenceFirewallClass =
  | "FACT"
  | "SUPPORTED_INFERENCE"
  | "HYPOTHESIS"
  | "TEMPLATE_ASSUMPTION"
  | "UNKNOWN";

export interface FirewallEvidenceInput {
  id: string;
  /** 证据本体是真实采集（REAL）还是模板/演示（DEMO）。 */
  nature: "REAL" | "DEMO";
  verifyStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  /** 可选：该证据上的断言类型。缺省按 FACT 处理（证据级分类）。 */
  claimKind?: "FACT" | "INFERENCE" | "ASSUMPTION" | null;
  fieldKey?: string | null;
}

/**
 * 证据防火墙：确定性分类，不依赖任何模型判断。
 *
 * 顺序即优先级，任何一步命中即返回，不允许后面的分支把前面的结论「升级」。
 */
export function classifyEvidence(
  evidence: FirewallEvidenceInput
): EvidenceFirewallClass {
  // 1. 模板 / 演示数据永远是模板推断，哪怕它被标成 VERIFIED。
  if (evidence.nature === "DEMO") return "TEMPLATE_ASSUMPTION";
  // 2. 被否决的证据不再提供任何信息。
  if (evidence.verifyStatus === "REJECTED") return "UNKNOWN";
  // 3. 未核实材料只能当假设，不能当事实。
  if (evidence.verifyStatus !== "VERIFIED") return "HYPOTHESIS";

  // 4. 已核实的 REAL 证据，再按断言类型分档。
  if (evidence.claimKind === "INFERENCE") return "SUPPORTED_INFERENCE";
  if (evidence.claimKind === "ASSUMPTION") return "HYPOTHESIS";
  return "FACT";
}

/**
 * 防火墙分类 → 该**单条证据**能达到的最高证据状态。
 *
 * 注意这里是「上限」而不是最终结论：维度级状态还要按聚合规则进一步收紧——
 * 只有「全部必需事实都由 FACT 支撑」才允许 VERIFIED；
 * 只有推断/假设支撑的维度会被压到 ASSUMED（模型推断不得自动升级成 SUPPORTED）。
 */
export const FIREWALL_STATE_CEILING: Record<
  EvidenceFirewallClass,
  PotentialEvidenceState
> = {
  FACT: "VERIFIED",
  SUPPORTED_INFERENCE: "SUPPORTED",
  HYPOTHESIS: "ASSUMED",
  TEMPLATE_ASSUMPTION: "ASSUMED",
  UNKNOWN: "UNKNOWN",
};

/** 只有 FACT 能进入 verifiedCoverageRatio 的分子。 */
export function countsAsVerified(cls: EvidenceFirewallClass): boolean {
  return cls === "FACT";
}

/** 模板推断 / 未知证据不参与打分。 */
export function canScoreDimension(cls: EvidenceFirewallClass): boolean {
  return cls === "FACT" || cls === "SUPPORTED_INFERENCE" || cls === "HYPOTHESIS";
}

// ---------------------------------------------------------------------------
// B. 7 维 rubric
// ---------------------------------------------------------------------------

/**
 * 一条「必需事实」。rubric 的可测性来自这里：每个维度需要哪些事实、缺了要怎么补、
 * 谁能补，全部显式登记，不由模型临场决定。
 */
export interface RequiredFact {
  /** 与 evidence-claims.ts 的 fieldKey 约定保持一致，便于复用已有缺口口径。 */
  fieldKey: string;
  label: string;
  whyItMatters: string;
  suggestedSource: string;
  suggestedQuery: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  /** 能否由研究链路自动补齐（检索 / 抓取 / 公开数据）。 */
  canAutoResearch: boolean;
  /** 是否必须由人（工厂、渠道、负责人）提供。 */
  requiresHumanInput: boolean;
}

export interface RubricBand {
  /** 达到该档至少需要覆盖几条必需事实。 */
  minCovered: number;
  score: number;
  label: string;
}

export interface DimensionRubric {
  key: PotentialDimensionKey;
  label: string;
  requiredFacts: RequiredFact[];
  /** 按 minCovered 降序匹配，取第一个满足的档。 */
  bands: RubricBand[];
  /**
   * 只有推断 / 假设、没有任何事实级证据时，该维度允许的最高分。
   * 目的：证据不足时不允许出现高分，避免「模型觉得应该是 80 分」。
   */
  inferenceOnlyCap: number;
}

function fact(params: {
  fieldKey: string;
  label: string;
  whyItMatters: string;
  suggestedSource: string;
  suggestedQuery: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  canAutoResearch: boolean;
  requiresHumanInput: boolean;
}): RequiredFact {
  return params;
}

const DEMAND_RUBRIC: DimensionRubric = {
  key: "DEMAND",
  label: "需求",
  requiredFacts: [
    fact({
      fieldKey: "salesVolume",
      label: "同类产品真实成交/销量",
      whyItMatters: "没有真实成交，需求只是描述而不是事实；「热销」不得由资料数量推断",
      suggestedSource: "电商平台公开销量、行业报告、渠道商反馈",
      suggestedQuery: "同类产品 月销 销量 成交",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "price",
      label: "竞品价格带与成交价",
      whyItMatters: "价格带决定付费意愿是否存在，也是成本反推的前提",
      suggestedSource: "电商详情页到手价、渠道报价单",
      suggestedQuery: "竞品 到手价 价格带",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "targetAudience",
      label: "付费人群与规模",
      whyItMatters: "没有人群规模，需求强弱无法量化",
      suggestedSource: "行业报告、平台人群画像、自有用户数据",
      suggestedQuery: "目标人群 规模 消费画像",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "painPoint",
      label: "用户痛点原文证据",
      whyItMatters: "痛点必须来自真实反馈原文，模板痛点不算证据",
      suggestedSource: "电商差评、客服记录、用户访谈",
      suggestedQuery: "差评 痛点 抱怨",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
  ],
  bands: [
    { minCovered: 4, score: 90, label: "四项事实齐备" },
    { minCovered: 3, score: 80, label: "缺一项非关键事实" },
    { minCovered: 2, score: 60, label: "仅两项事实" },
    { minCovered: 1, score: 40, label: "仅一项事实" },
  ],
  inferenceOnlyCap: 45,
};

const CHANNEL_FIT_RUBRIC: DimensionRubric = {
  key: "CHANNEL_FIT",
  label: "渠道适配",
  requiredFacts: [
    fact({
      fieldKey: "channel",
      label: "目标渠道与适配规则",
      whyItMatters: "渠道规则（价格带、起订量）不确认，渠道成立与否无法判断",
      suggestedSource: "渠道招商政策、平台规则、渠道商确认",
      suggestedQuery: "渠道 招商规则 价格带 起订量",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "channelCommission",
      label: "渠道佣金与平台扣点",
      whyItMatters: "佣金直接决定渠道是否还有正贡献",
      suggestedSource: "渠道费率表、平台扣点规则",
      suggestedQuery: "佣金 扣点 费率",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "channelPriceBand",
      label: "该渠道实际成交价格带",
      whyItMatters: "渠道价格带与产品定价不匹配则渠道不成立",
      suggestedSource: "该渠道在售同类品成交价",
      suggestedQuery: "渠道 同类 成交价",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "channelFeedback",
      label: "该渠道真实反馈或试销",
      whyItMatters: "只有真实反馈/试销才能把渠道适配从推断升级为已验证",
      suggestedSource: "渠道试销数据、渠道商反馈、直播间实测",
      suggestedQuery: "试销 反馈 转化",
      priority: "MEDIUM",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
  ],
  bands: [
    { minCovered: 4, score: 90, label: "四项事实齐备" },
    { minCovered: 3, score: 80, label: "缺一项非关键事实" },
    { minCovered: 2, score: 65, label: "仅两项事实" },
    { minCovered: 1, score: 45, label: "仅一项事实" },
  ],
  inferenceOnlyCap: 50,
};

/**
 * 单位经济性：**不由覆盖数打分**，而是要求「工厂报价 + 零售价」两个事实级输入，
 * 再交给 `grossMarginScore()` 用确定性代码算毛利后映射档位。
 * 缺任一输入即 `UNKNOWN`——不允许用 `price × 比例` 之类的模板值顶替报价。
 */
const UNIT_ECONOMICS_RUBRIC: DimensionRubric = {
  key: "UNIT_ECONOMICS",
  label: "单位经济性",
  requiredFacts: [
    fact({
      fieldKey: "costQuote",
      label: "工厂/供应链报价",
      whyItMatters: "没有报价就没有成本，任何毛利结论都是假设",
      suggestedSource: "工厂报价单、打样单、供应商确认",
      suggestedQuery: "工厂 报价 成本",
      priority: "HIGH",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
    fact({
      fieldKey: "price",
      label: "零售价/到手价",
      whyItMatters: "毛利的分母，缺失则无法计算",
      suggestedSource: "电商到手价、渠道定价方案",
      suggestedQuery: "零售价 到手价",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "channelFee",
      label: "渠道佣金与平台扣点",
      whyItMatters: "贡献毛利而非账面毛利才是渠道真实收益",
      suggestedSource: "渠道费率表",
      suggestedQuery: "佣金 扣点",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "packagingFreight",
      label: "包装与运费单件成本",
      whyItMatters: "包材与运费常被漏算，会系统性高估毛利",
      suggestedSource: "包材报价、物流报价",
      suggestedQuery: "包材 运费 报价",
      priority: "MEDIUM",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
  ],
  bands: [],
  inferenceOnlyCap: 0,
};

const DIFFERENTIATION_RUBRIC: DimensionRubric = {
  key: "DIFFERENTIATION",
  label: "差异化",
  requiredFacts: [
    fact({
      fieldKey: "formulaOrTech",
      label: "配方/成分/工艺差异",
      whyItMatters: "差异必须落在产品本体上，而不是包装话术",
      suggestedSource: "配方单、专利文件、原料规格书",
      suggestedQuery: "配方 成分 工艺 差异",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "competitorComparison",
      label: "与竞品的可比较差异",
      whyItMatters: "没有竞品对照，「差异」无法成立",
      suggestedSource: "竞品成分表、检测报告、评测内容",
      suggestedQuery: "竞品 成分 对比",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "ipOrPatent",
      label: "专利/独家原料/独占供应",
      whyItMatters: "可独占的差异才是可持续的差异",
      suggestedSource: "专利检索、独家授权文件",
      suggestedQuery: "专利 独家 原料",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "consumerPerception",
      label: "消费者是否感知到差异",
      whyItMatters: "感知不到的差异不产生溢价",
      suggestedSource: "试销反馈、评论区、访谈",
      suggestedQuery: "反馈 感知 差异",
      priority: "MEDIUM",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
  ],
  bands: [
    { minCovered: 4, score: 88, label: "四项事实齐备" },
    { minCovered: 3, score: 75, label: "缺一项非关键事实" },
    { minCovered: 2, score: 60, label: "仅两项事实" },
    { minCovered: 1, score: 40, label: "仅一项事实" },
  ],
  inferenceOnlyCap: 45,
};

const REPEAT_PURCHASE_RUBRIC: DimensionRubric = {
  key: "REPEAT_PURCHASE",
  label: "复购",
  requiredFacts: [
    fact({
      fieldKey: "consumptionCycle",
      label: "单次使用周期（净含量/剂量）",
      whyItMatters: "使用周期决定复购节奏，缺失则复购无法估算",
      suggestedSource: "规格表、净含量、每日用量",
      suggestedQuery: "净含量 用量 周期",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "repurchaseData",
      label: "复购率/复购周期实测",
      whyItMatters: "复购是实测指标，不能靠品类常识替代",
      suggestedSource: "自有私域复购数据、渠道复购报表",
      suggestedQuery: "复购率 复购周期",
      priority: "HIGH",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
    fact({
      fieldKey: "userFeedback",
      label: "使用后反馈/口碑",
      whyItMatters: "口碑是复购的前置信号",
      suggestedSource: "评论区、社群反馈、客服记录",
      suggestedQuery: "使用反馈 口碑",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "subscriptionSignal",
      label: "订阅/复购机制信号",
      whyItMatters: "有机制才能把复购变成可预期收入",
      suggestedSource: "订阅方案、渠道复购活动",
      suggestedQuery: "订阅 复购机制",
      priority: "LOW",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
  ],
  bands: [
    { minCovered: 4, score: 85, label: "四项事实齐备" },
    { minCovered: 3, score: 72, label: "缺一项非关键事实" },
    { minCovered: 2, score: 55, label: "仅两项事实" },
    { minCovered: 1, score: 35, label: "仅一项事实" },
  ],
  inferenceOnlyCap: 40,
};

const DELIVERY_FEASIBILITY_RUBRIC: DimensionRubric = {
  key: "DELIVERY_FEASIBILITY",
  label: "交付可行性",
  requiredFacts: [
    fact({
      fieldKey: "supplierConfirmation",
      label: "供应商可交付确认",
      whyItMatters: "没有供应商确认，交付只是计划",
      suggestedSource: "供应商确认函、打样回执",
      suggestedQuery: "供应商 确认 产能",
      priority: "HIGH",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
    fact({
      fieldKey: "dosageForm",
      label: "剂型与工艺路线",
      whyItMatters: "剂型决定工艺与成本结构",
      suggestedSource: "工艺方案、工厂确认",
      suggestedQuery: "剂型 工艺",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "leadTime",
      label: "交付周期与产能",
      whyItMatters: "周期与产能决定能否承接渠道节奏",
      suggestedSource: "工厂排产计划、交付周期确认",
      suggestedQuery: "交付周期 产能",
      priority: "MEDIUM",
      canAutoResearch: false,
      requiresHumanInput: true,
    }),
    fact({
      fieldKey: "compliancePackaging",
      label: "包装与合规要件",
      whyItMatters: "包装合规缺失会直接阻断上市",
      suggestedSource: "包装稿、合规审查意见",
      suggestedQuery: "包装 合规 标签",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
  ],
  bands: [
    { minCovered: 4, score: 88, label: "四项事实齐备" },
    { minCovered: 3, score: 80, label: "缺一项非关键事实" },
    { minCovered: 2, score: 65, label: "仅两项事实" },
    { minCovered: 1, score: 45, label: "仅一项事实" },
  ],
  inferenceOnlyCap: 50,
};

const COMPANY_FIT_RUBRIC: DimensionRubric = {
  key: "COMPANY_FIT",
  label: "公司匹配",
  requiredFacts: [
    fact({
      fieldKey: "companyPolicy",
      label: "公司品类/战略方向",
      whyItMatters: "与公司方向不一致的产品不该占用验证预算",
      suggestedSource: "公司品类规划、战略文档",
      suggestedQuery: "品类规划 战略方向",
      priority: "HIGH",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "existingCapability",
      label: "已有能力与团队",
      whyItMatters: "能力缺口决定交付风险",
      suggestedSource: "内部能力盘点",
      suggestedQuery: "能力 团队 盘点",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "channelOwnership",
      label: "已有渠道/私域资源",
      whyItMatters: "已有渠道能把冷启动成本降到最低",
      suggestedSource: "渠道资源清单、私域用户规模",
      suggestedQuery: "私域 渠道资源",
      priority: "MEDIUM",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
    fact({
      fieldKey: "brandPortfolio",
      label: "品牌组合与定位契合",
      whyItMatters: "品牌错配会稀释既有定位",
      suggestedSource: "品牌矩阵与定位文档",
      suggestedQuery: "品牌 定位 组合",
      priority: "LOW",
      canAutoResearch: true,
      requiresHumanInput: false,
    }),
  ],
  bands: [
    { minCovered: 4, score: 90, label: "四项事实齐备" },
    { minCovered: 3, score: 82, label: "缺一项非关键事实" },
    { minCovered: 2, score: 70, label: "仅两项事实" },
    { minCovered: 1, score: 50, label: "仅一项事实" },
  ],
  inferenceOnlyCap: 55,
};

export const DIMENSION_RUBRICS: Record<PotentialDimensionKey, DimensionRubric> = {
  DEMAND: DEMAND_RUBRIC,
  CHANNEL_FIT: CHANNEL_FIT_RUBRIC,
  UNIT_ECONOMICS: UNIT_ECONOMICS_RUBRIC,
  DIFFERENTIATION: DIFFERENTIATION_RUBRIC,
  REPEAT_PURCHASE: REPEAT_PURCHASE_RUBRIC,
  DELIVERY_FEASIBILITY: DELIVERY_FEASIBILITY_RUBRIC,
  COMPANY_FIT: COMPANY_FIT_RUBRIC,
};

/** 维度评估顺序：与 potential-assessment 的权重表保持一致。 */
export const COMPILER_DIMENSION_ORDER: PotentialDimensionKey[] = [
  "DEMAND",
  "CHANNEL_FIT",
  "UNIT_ECONOMICS",
  "DIFFERENTIATION",
  "REPEAT_PURCHASE",
  "DELIVERY_FEASIBILITY",
  "COMPANY_FIT",
];

/** 按 minCovered 取档；覆盖数为 0 时返回 null（未知就是未知，不给 0 分）。 */
export function pickRubricBand(
  rubric: DimensionRubric,
  coveredCount: number
): RubricBand | null {
  if (coveredCount <= 0) return null;
  const ordered = [...rubric.bands].sort((a, b) => b.minCovered - a.minCovered);
  return ordered.find((band) => coveredCount >= band.minCovered) ?? null;
}

// ---------------------------------------------------------------------------
// 输入 / 输出形状
// ---------------------------------------------------------------------------

/** 一条已落库的证据（含其断言）。字段与 prisma Evidence / EvidenceClaim 对齐。 */
export interface CompilerEvidence {
  id: string;
  source: string;
  nature: "REAL" | "DEMO";
  verifyStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  validationStatus?: "UNAPPLIED" | "IN_PROGRESS" | "VERIFIED_BY_LEAD" | string;
  channel?: string | null;
  claims?: Array<{
    id: string;
    fieldKey: string;
    kind: "FACT" | "INFERENCE" | "ASSUMPTION";
    value: string;
  }>;
}
/** 模板推断值：可展示，但**不得**进入正式评分。 */
export interface TemplateAssumption {
  dimension: PotentialDimensionKey | null;
  fieldKey: string;
  label: string;
  /** 展示用文本，必须自带「假设」措辞，避免被读成市场事实。 */
  displayText: string;
  /** 该假设来自哪里（代码位置或规则名），便于人工复核。 */
  origin: string;
}

/**
 * 假设的两种来源。区分它们很重要：
 * - `HYPOTHESIS`：有材料但未核实（未核实证据、或已核实证据上的假设断言）——**可能**通过补证升级。
 * - `TEMPLATE`：规则模板 / 演示数据——**不可能**通过补证升级，只能被真实证据替换。
 */
export type AssumptionBasis = "HYPOTHESIS" | "TEMPLATE";

/**
 * 待核验假设台账（研发办公室持续职责之一）。
 *
 * 为什么要有这个台账：推断与模板值此前只会体现在「分数被压低」上，
 * 但没有任何地方能回答「现在有哪些东西是我们**以为**的、还没验证过」。
 * 持续办公需要把这件事列出来，才能决定下一步核验什么。
 */
export interface CompiledAssumption {
  /** 幂等键：同一件事重复计算得到同一个键（办公室据此去重，不重复建任务）。 */
  key: string;
  dimension: PotentialDimensionKey | null;
  fieldKey: string;
  label: string;
  basis: AssumptionBasis;
  /** 被当作假设的内容（原值）。 */
  statement: string;
  /** 该假设依赖的证据（模板假设为空）。 */
  evidenceIds: string[];
  claimIds: string[];
  /** 为什么它现在还不能算事实。 */
  whyUnverified: string;
  /** 建议怎么核验。 */
  verificationSuggestion: string;
}

/** 待核验假设的幂等键。同维度 + 同字段 + 同内容 → 同一个键。 */
export function assumptionKey(params: {
  dimension: PotentialDimensionKey | null;
  fieldKey: string;
  statement: string;
  basis: AssumptionBasis;
}): string {
  return `assumption:${params.basis}:${params.dimension ?? "GATE"}:${
    params.fieldKey
  }:${params.statement}`;
}

/** 可执行的证据缺口（P0-4）。 */
export interface CompiledEvidenceGap {
  dimension: PotentialDimensionKey | null;
  /** 门槛缺口时给出 gate key，否则为 null。 */
  gateKey: string | null;
  /**
   * 缺口对应的业务字段（与 evidence-claims.ts 的 fieldKey 同一套口径）；
   * 门槛缺口为 null。持续办公用它做**幂等键**，避免同一缺口重复建任务。
   */
  fieldKey: string | null;
  missingFact: string;
  whyItMatters: string;
  suggestedSource: string;
  suggestedQuery: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  canAutoResearch: boolean;
  requiresHumanInput: boolean;
}

/**
 * 缺口的幂等键：同一维度 + 同一字段（或同一门槛）得到同一个键。
 *
 * 注意这里**不含** `priority` / `suggestedQuery` 等描述性字段——那些会随文案调整而变，
 * 一旦进入键，同一条缺口就会被当成新缺口，办公室会重复建任务。
 */
export function evidenceGapKey(gap: CompiledEvidenceGap): string {
  if (gap.gateKey) return `gap:GATE:${gap.gateKey}`;
  return `gap:${gap.dimension ?? "GENERAL"}:${gap.fieldKey ?? gap.missingFact}`;
}

/** 带完整可追溯性的维度（Compiler 产出；`PotentialDimensionInput` 是其超集）。 */
export interface CompiledDimension extends PotentialDimensionInput {
  /** 支撑该维度评分的证据 id（sourceRefs 的结构化版本）。 */
  evidenceIds: string[];
  claimIds: string[];
  /** 该维度尚未覆盖的必需事实（fieldKey）。 */
  missingEvidence: string[];
  /** 本维度实际用到的防火墙分类（去重）。 */
  firewallClasses: EvidenceFirewallClass[];
  /** 命中的 rubric 档位描述；未打分时为 null。 */
  rubricBand: string | null;
  /** 是否只由推断/假设支撑（此时分数被 inferenceOnlyCap 压住）。 */
  inferenceOnly: boolean;
}

export interface CompileProductPotentialParams {
  evidence: CompilerEvidence[];
  /** 门槛由调用方给出（门槛口径的唯一实现仍在 channel-routes-service）。 */
  gates?: PotentialGateInput[];
  /** 是否已有负责人确认过的真实市场验证；缺省 false（宁可保守）。 */
  marketValidationVerified?: boolean;
  /**
   * 路线级渠道匹配器，由 `channel-routes-service` 注入（复用同一份渠道名归一化口径，
   * 本模块不另造一份）。
   *
   * 给出时，CHANNEL_FIT 只采信被该匹配器认可的证据，与
   * `validatePotentialDimensionEvidence` 的路线级校验同一口径——避免出现
   * 「编译层判 VERIFIED、落库前的校验层判不通过」的自相矛盾。
   */
  matchesRouteChannel?: (evidenceChannel: string | null) => boolean;
  /** 产出时间，便于快照比对；缺省取当前时间。 */
  now?: Date;
}

export interface CompileProductPotentialResult {
  input: ProductPotentialInput;
  dimensions: CompiledDimension[];
  gaps: CompiledEvidenceGap[];
  /** 待核验假设台账（HYPOTHESIS + TEMPLATE 全量）。 */
  assumptions: CompiledAssumption[];
  /** `assumptions` 里 `basis === "TEMPLATE"` 的展示视图（界面用，自带「假设」措辞）。 */
  templateAssumptions: TemplateAssumption[];
  /**
   * 防火墙拦截记录：描述哪些内容被拒绝升级为事实级证据。
   * 正常情况为空；非空即说明有调用方试图把模板/未核实内容当事实，需人工复核。
   */
  firewallRejections: string[];
}

// ---------------------------------------------------------------------------
// 编译
// ---------------------------------------------------------------------------

interface ClaimHit {
  evidenceId: string;
  claimId: string | null;
  fieldKey: string;
  value: string;
  firewallClass: EvidenceFirewallClass;
  source: string;
  /** 证据标注的适用渠道；路线级判定要用它做渠道匹配。 */
  channel: string | null;
}

/** 把证据展开成「字段命中」列表，每条带防火墙分类。 */
function collectClaimHits(evidence: CompilerEvidence[]): ClaimHit[] {
  const hits: ClaimHit[] = [];
  for (const item of evidence) {
    const firewallInput = {
      id: item.id,
      nature: item.nature,
      verifyStatus: item.verifyStatus,
    };
    const channel = item.channel ?? null;
    const claims = item.claims ?? [];
    if (claims.length === 0) {
      // 证据级命中：按证据自身分类，字段取证据级占位。
      hits.push({
        evidenceId: item.id,
        claimId: null,
        fieldKey: "",
        value: "",
        firewallClass: classifyEvidence({ ...firewallInput, claimKind: null }),
        source: item.source,
        channel,
      });
      continue;
    }
    for (const claim of claims) {
      hits.push({
        evidenceId: item.id,
        claimId: claim.id,
        fieldKey: claim.fieldKey,
        value: claim.value,
        firewallClass: classifyEvidence({
          ...firewallInput,
          claimKind: claim.kind,
        }),
        source: item.source,
        channel,
      });
    }
  }
  return hits;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildMissingGaps(
  dimension: PotentialDimensionKey,
  rubric: DimensionRubric,
  missing: RequiredFact[]
): CompiledEvidenceGap[] {
  return missing.map((item) => ({
    dimension,
    gateKey: null,
    fieldKey: item.fieldKey,
    missingFact: `${rubric.label}：${item.label}（${item.fieldKey}）`,
    whyItMatters: item.whyItMatters,
    suggestedSource: item.suggestedSource,
    suggestedQuery: item.suggestedQuery,
    priority: item.priority,
    canAutoResearch: item.canAutoResearch,
    requiresHumanInput: item.requiresHumanInput,
  }));
}

/**
 * 核心编译函数：Evidence → ProductPotentialInput（+ 可追溯轨迹 + 缺口）。
 *
 * 全程确定性：同样的证据输入必然得到同样的维度分数，不调用模型。
 */
export function compileProductPotentialInput(
  params: CompileProductPotentialParams
): CompileProductPotentialResult {
  const evidence = params.evidence ?? [];
  const hits = collectClaimHits(evidence);
  const now = (params.now ?? new Date()).toISOString();

  const assumptions: CompiledAssumption[] = [];
  const firewallRejections: string[] = [];
  const dimensions: CompiledDimension[] = [];
  const gaps: CompiledEvidenceGap[] = [];

  for (const key of COMPILER_DIMENSION_ORDER) {
    const rubric = DIMENSION_RUBRICS[key];

    // 该维度相关命中：字段级命中按 fieldKey 匹配，证据级命中（fieldKey 为空）
    // 视为通用支撑，参与「是否只有模板/假设」的判断但不单独覆盖必需事实。
    const allFieldHits = hits.filter((hit) => hit.fieldKey !== "");
    // CHANNEL_FIT 是路线级判断：只采信该路线渠道的证据，其余维度不按渠道过滤。
    const fieldHits =
      key === "CHANNEL_FIT" && params.matchesRouteChannel
        ? allFieldHits.filter((hit) => params.matchesRouteChannel!(hit.channel))
        : allFieldHits;
    const coveredKeys = new Set(
      fieldHits
        .filter((hit) => canScoreDimension(hit.firewallClass))
        .map((hit) => hit.fieldKey)
    );

    const requiredKeys = rubric.requiredFacts.map((f) => f.fieldKey);
    const coveredFacts = rubric.requiredFacts.filter((f) =>
      coveredKeys.has(f.fieldKey)
    );
    const missingFacts = rubric.requiredFacts.filter(
      (f) => !coveredKeys.has(f.fieldKey)
    );

    // 本维度相关证据的防火墙分类（只取字段命中到本维度必需事实的，以及通用证据）。
    const relevantHits = fieldHits.filter((hit) =>
      requiredKeys.includes(hit.fieldKey)
    );
    const firewallClasses = unique(relevantHits.map((hit) => hit.firewallClass));

    // 假设台账：模板推断与未核实/假设级内容都要登记，并且**不计入**覆盖数
    // （coveredKeys 已按 canScoreDimension 过滤）。
    const assumptionHits = relevantHits.filter(
      (hit) =>
        hit.firewallClass === "TEMPLATE_ASSUMPTION" ||
        hit.firewallClass === "HYPOTHESIS"
    );
    const seenAssumption = new Set<string>();
    for (const hit of assumptionHits) {
      const basis: AssumptionBasis =
        hit.firewallClass === "TEMPLATE_ASSUMPTION" ? "TEMPLATE" : "HYPOTHESIS";
      const assumptionId = assumptionKey({
        dimension: key,
        fieldKey: hit.fieldKey,
        statement: hit.value,
        basis,
      });
      if (seenAssumption.has(assumptionId)) continue;
      seenAssumption.add(assumptionId);
      assumptions.push({
        key: assumptionId,
        dimension: key,
        fieldKey: hit.fieldKey,
        label:
          rubric.requiredFacts.find((f) => f.fieldKey === hit.fieldKey)?.label ??
          hit.fieldKey,
        basis,
        statement: hit.value,
        evidenceIds: [hit.evidenceId],
        claimIds: hit.claimId ? [hit.claimId] : [],
        whyUnverified:
          basis === "TEMPLATE"
            ? "来自规则模板/演示数据，不是真实来源，补证也不能把它升级为事实，只能被真实证据替换"
            : "材料尚未独立核实，或该条本身就是假设断言；在拿到事实级证据前不能当作已验证结论",
        verificationSuggestion:
          basis === "TEMPLATE"
            ? `用真实来源替换该模板值（${hit.source}）`
            : `核对该来源并补齐事实级证据：${hit.source}`,
      });
    }

    // 事实级覆盖：必需事实里由 FACT 支撑的部分（决定 evidenceState）。
    const factCoveredKeys = new Set(
      relevantHits
        .filter((hit) => countsAsVerified(hit.firewallClass))
        .map((hit) => hit.fieldKey)
    );
    const allFactsVerified =
      rubric.requiredFacts.length > 0 &&
      rubric.requiredFacts.every((f) => factCoveredKeys.has(f.fieldKey));

    // 只有**真正参与打分**的命中才能进 evidenceIds / claimIds / sourceRefs。
    // 模板推断与被否决的证据只登记在 templateAssumptions / firewallClasses 里——
    // 把它们写进 sourceRefs 会让人以为该证据支撑了这个分数。
    const scoreable = relevantHits.filter((hit) =>
      canScoreDimension(hit.firewallClass)
    );
    const evidenceIds = unique(scoreable.map((hit) => hit.evidenceId));
    const claimIds = unique(
      scoreable
        .map((hit) => hit.claimId)
        .filter((id): id is string => Boolean(id))
    );
    const sourceRefs = evidenceIds.map((id) => `evidence:${id}`);

    const inferenceOnly = scoreable.length > 0 && factCoveredKeys.size === 0;

    let score: number | null = null;
    let rubricBand: string | null = null;

    if (key === "UNIT_ECONOMICS") {
      // 单位经济性：必须拿到事实级的报价与零售价，交给确定性代码算毛利。
      const costHit = relevantHits.find(
        (hit) =>
          hit.fieldKey === "costQuote" &&
          countsAsVerified(hit.firewallClass)
      );
      const priceHit = relevantHits.find(
        (hit) => hit.fieldKey === "price" && countsAsVerified(hit.firewallClass)
      );
      if (costHit && priceHit) {
        const cost = parseAmount(costHit.value);
        const price = parseAmount(priceHit.value);
        const margin =
          cost !== null && price !== null ? grossMarginScore(price, cost) : null;
        if (margin) {
          score = margin.score;
          rubricBand = margin.band;
        }
      }
      if (score === null && (costHit || priceHit)) {
        // 只有一半输入：明确说明缺哪一半，不给任何替代分数。
        firewallRejections.push(
          `UNIT_ECONOMICS 仅有 ${costHit ? "报价" : "零售价"}，缺少${
            costHit ? "零售价" : "工厂报价"
          }，保持 UNKNOWN（不允许用价格比例推算成本）`
        );
      }
    } else {
      const band = pickRubricBand(rubric, coveredFacts.length);
      if (band) {
        score = band.score;
        rubricBand = band.label;
        if (inferenceOnly) {
          score = Math.min(score, rubric.inferenceOnlyCap);
          rubricBand = `${band.label}（仅推断/假设，分数上限 ${rubric.inferenceOnlyCap}）`;
        }
      }
    }

    /**
     * 维度级证据状态（比单条证据的上限更严）：
     * - 全部必需事实都由 FACT 支撑 → VERIFIED；
     * - 只有推断/假设支撑 → ASSUMED（模型推断不得自动升级成 SUPPORTED）；
     * - 有部分事实级证据但未覆盖全部 → SUPPORTED；
     * - 没有分数 → UNKNOWN。
     */
    const evidenceState: PotentialEvidenceState =
      score === null
        ? "UNKNOWN"
        : allFactsVerified
          ? "VERIFIED"
          : inferenceOnly
            ? "ASSUMED"
            : "SUPPORTED";

    // 防御性一致性：UNKNOWN 必须 null，非 UNKNOWN 必须有分数。
    // （potential-assessment 对 score=null 且 state≠UNKNOWN 会直接抛错。）
    const normalizedScore = evidenceState === "UNKNOWN" ? null : score;
    const normalizedState: PotentialEvidenceState =
      normalizedScore === null ? "UNKNOWN" : evidenceState;

    dimensions.push({
      key,
      score: normalizedScore,
      evidenceState: normalizedState,
      rationale: buildRationale({
        rubric,
        coveredCount: coveredFacts.length,
        totalFacts: rubric.requiredFacts.length,
        inferenceOnly,
        score: normalizedScore,
        band: rubricBand,
      }),
      sourceRefs: normalizedState === "UNKNOWN" ? [] : sourceRefs,
      evidenceIds: normalizedState === "UNKNOWN" ? [] : evidenceIds,
      claimIds: normalizedState === "UNKNOWN" ? [] : claimIds,
      missingEvidence: missingFacts.map((f) => f.fieldKey),
      firewallClasses,
      rubricBand,
      inferenceOnly,
      updatedAt: now,
    });

    gaps.push(...buildMissingGaps(key, rubric, missingFacts));
  }

  // 门槛未知也要补证，否则 Mission 会在「看起来完成了」的状态下结束。
  for (const gate of params.gates ?? []) {
    if (gate.status !== "UNKNOWN") continue;
    gaps.push({
      dimension: null,
      gateKey: gate.key,
      fieldKey: null,
      missingFact: `硬门槛未知：${gate.label}`,
      whyItMatters: gate.reason || "门槛未确认时不能用评分代替缺失事实",
      suggestedSource: "对应门槛的原始凭据（渠道规则 / 合规结论 / 成本核算）",
      suggestedQuery: gate.label,
      priority: "HIGH",
      canAutoResearch: false,
      requiresHumanInput: true,
    });
  }

  return {
    input: {
      dimensions: dimensions.map(
        ({ key, score, evidenceState, rationale, sourceRefs }) => ({
          key,
          score,
          evidenceState,
          rationale,
          sourceRefs,
        })
      ),
      gates: params.gates ?? [],
      marketValidationVerified: params.marketValidationVerified === true,
    },
    dimensions,
    gaps,
    assumptions,
    // 展示视图从台账派生，避免两处各存一份。
    templateAssumptions: assumptions
      .filter((item) => item.basis === "TEMPLATE")
      .map((item) => ({
        dimension: item.dimension,
        fieldKey: item.fieldKey,
        label: item.label,
        displayText: `假设值：${item.statement}（用于方案模拟，尚无真实来源支持）`,
        origin: item.evidenceIds.map((id) => `evidence:${id}`).join("、") || "rule",
      })),
    firewallRejections,
  };
}

function buildRationale(params: {
  rubric: DimensionRubric;
  coveredCount: number;
  totalFacts: number;
  inferenceOnly: boolean;
  score: number | null;
  band: string | null;
}): string {
  const { rubric, coveredCount, totalFacts, inferenceOnly, score, band } = params;
  if (score === null) {
    return `${rubric.label}：${totalFacts} 项必需事实中 0 项有可用证据，保持未知（不用 0 分冒充）。`;
  }
  const base = `${rubric.label}：${totalFacts} 项必需事实覆盖 ${coveredCount} 项，命中档位「${band ?? "—"}」→ ${score} 分。`;
  return inferenceOnly
    ? `${base} 当前仅有推断/假设级证据，未取得事实级证据，分数已被上限约束。`
    : base;
}

// ---------------------------------------------------------------------------
// C. Gap → Research → Rescore 的停止条件
// ---------------------------------------------------------------------------

export type GapLoopStopCode =
  | "GATE_FAILED"
  | "COVERAGE_SUFFICIENT"
  | "BUDGET_EXHAUSTED"
  | "HUMAN_ONLY"
  | "NO_NEW_EVIDENCE"
  | "CONTINUE";

export interface GapLoopState {
  assessment: ProductPotentialAssessment;
  /** Compiler 产出的维度快照，用于判断是否仍有 UNKNOWN 维度。 */
  dimensions: CompiledDimension[];
  gaps: CompiledEvidenceGap[];
  /** 已完成的补证轮数。 */
  roundsCompleted: number;
  /** 允许的最大补证轮数（来自研究档位预算或调用方配置）。 */
  maxRounds: number;
  /** 连续多少轮没有新增有效证据。 */
  roundsWithoutNewEvidence: number;
  /** 本轮新增的证据 id 数（0 表示没有新证据进来）。 */
  newEvidenceCount: number;
}

export interface GapLoopDecision {
  continue: boolean;
  code: GapLoopStopCode;
  reason: string;
  /** 下一轮建议优先补的缺口（按 priority 排序，最多 3 条）。 */
  nextTargets: CompiledEvidenceGap[];
}

const PRIORITY_ORDER: Record<CompiledEvidenceGap["priority"], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

/** 连续无新增证据达到该轮数即停止，避免无限检索。 */
export const MAX_ROUNDS_WITHOUT_NEW_EVIDENCE = 2;

/** 覆盖率达标线：达到即认为证据已足够形成结论。 */
export const COVERAGE_SUFFICIENT_THRESHOLD = 0.85;

/**
 * 判定补证循环是否继续。顺序即优先级：
 * 硬门槛失败 → 覆盖已足够 → 预算耗尽 → 只剩人工输入 → 连续无新证据 → 继续。
 */
export function decideEvidenceGapLoop(state: GapLoopState): GapLoopDecision {
  const { assessment, dimensions, gaps } = state;
  const actionable = [...gaps].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );
  const nextTargets = actionable.slice(0, 3);

  if (assessment.blockers.length > 0) {
    return {
      continue: false,
      code: "GATE_FAILED",
      reason: `存在 ${assessment.blockers.length} 个硬门槛失败，补证不能改变门槛结论，应先修方案或停止投入。`,
      nextTargets: [],
    };
  }

  const unknownDimensions = dimensions.filter(
    (dimension) => dimension.evidenceState === "UNKNOWN"
  );
  if (
    assessment.coverageRatio >= COVERAGE_SUFFICIENT_THRESHOLD &&
    unknownDimensions.length === 0 &&
    assessment.unknownGates.length === 0
  ) {
    return {
      continue: false,
      code: "COVERAGE_SUFFICIENT",
      reason: `覆盖率 ${Math.round(assessment.coverageRatio * 100)}% 且无未知维度与未知门槛，证据已足够形成结论。`,
      nextTargets: [],
    };
  }

  if (state.roundsCompleted >= state.maxRounds) {
    return {
      continue: false,
      code: "BUDGET_EXHAUSTED",
      reason: `补证轮数已达上限 ${state.maxRounds} 轮，停止检索并如实保留未知。`,
      nextTargets,
    };
  }

  if (gaps.length > 0 && gaps.every((gap) => gap.requiresHumanInput)) {
    return {
      continue: false,
      code: "HUMAN_ONLY",
      reason: `剩余 ${gaps.length} 个缺口全部需要人工输入（工厂/渠道/负责人），自动研究无法推进，应转人工。`,
      nextTargets,
    };
  }

  if (state.roundsWithoutNewEvidence >= MAX_ROUNDS_WITHOUT_NEW_EVIDENCE) {
    return {
      continue: false,
      code: "NO_NEW_EVIDENCE",
      reason: `连续 ${state.roundsWithoutNewEvidence} 轮没有新增有效证据，继续检索的边际收益已归零。`,
      nextTargets,
    };
  }

  return {
    continue: true,
    code: "CONTINUE",
    reason: `仍有 ${actionable.filter((gap) => gap.canAutoResearch).length} 个可自动补证的缺口，进入下一轮研究。`,
    nextTargets,
  };
}

// ---------------------------------------------------------------------------
// 兼容导出：便于调用方一次性拿到「编译 + 判定」
// ---------------------------------------------------------------------------

export interface CompileAndAssessResult {
  compiled: CompileProductPotentialResult;
  assessment: ProductPotentialAssessment;
}

/**
 * 编译并判定。`assess` 由调用方注入，避免本模块 import 出循环依赖，
 * 也保证正式判定只有 `assessProductPotential()` 一个实现。
 */
export function compileAndAssess(
  params: CompileProductPotentialParams,
  assess: (input: ProductPotentialInput) => ProductPotentialAssessment
): CompileAndAssessResult {
  const compiled = compileProductPotentialInput(params);
  return { compiled, assessment: assess(compiled.input) };
}
