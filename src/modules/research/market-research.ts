/**
 * 真实资料与机会/竞品研究服务 (F07, F14, F15)
 *
 * 核心功能：
 * 1. 结构化输入处理：结合已核实证据、外部电商资料样本与需求解析约束；
 * 2. 标杆竞品与价格带分析（价格中位数、销量区间、核心卖点、负评痛点）；
 * 3. 制定 3 条可比路线（路线 A：极致性价比主推，路线 B：技术差异化高溢价，路线 C：轻定制概念探索）；
 * 4. 自动排除命中 forbidden 约束的剂型或宣称，杜绝反向污染。
 */

import { ParsedRequirementConstraints } from "./requirement-parser";
import { ResolvedFieldValue, computeEvidenceGaps } from "./evidence-claims";
import { synthesizeOpportunityAnalysis, OpportunityAnalysis } from "./opportunity-analysis";

export interface BenchmarkCompetitor {
  id: string;
  name: string;
  brand: string;
  price: number | null;
  salesVolumeDesc: string; // 保持区间原样，如 "5万~10万件"，无数据时明确标为待核验
  keyFeatures: string[];
  consumerPainPoints: string[];
  evidenceRefId?: string;
}

export interface FeasibleRoute {
  routeCode: "ROUTE_A" | "ROUTE_B" | "ROUTE_C";
  title: string;
  dosageForm: string;
  positioning: string;
  keyIngredients: string[];
  targetPrice: number;
  estimatedCost: number;
  pros: string[];
  risks: string[];
}

/**
 * 研究报告验证状态 (C02/R2-03 剩余项)
 *
 * 当前实现中，只有来自已核实证据原文的竞品价格/销量描述属于「有证据」结论；
 * 市场趋势、痛点、路线成分与成本比例、最优路线推荐均为规则模板推断。
 * 正式报告必须显式标注为待验证草案，禁止把模板推断包装成已验证事实。
 */
export interface ResearchVerification {
  /** DRAFT_UNVERIFIED: 无任何证据支撑；PARTIALLY_EVIDENCED: 仅部分字段有证据支撑 */
  status: "DRAFT_UNVERIFIED" | "PARTIALLY_EVIDENCED";
  evidencedSections: string[];
  inferredSections: string[];
  notes: string[];
}

export interface MarketResearchReport {
  projectId: string;
  generatedAt: string;
  categoryName: string;
  marketInsights: {
    overview: string;
    painPoints: string[];
    priceBandsSummary: string;
  };
  benchmarks: BenchmarkCompetitor[];
  candidateRoutes: FeasibleRoute[];
  recommendedRouteCode: "ROUTE_A" | "ROUTE_B" | "ROUTE_C";
  selectionRationale: string;
  verification: ResearchVerification;
  /** P1-02 机会分析与市场验证 */
  opportunityAnalysis: OpportunityAnalysis;
}

export function synthesizeMarketResearch(
  projectId: string,
  categoryName: string,
  constraints: ParsedRequirementConstraints,
  verifiedEvidenceSnippets: Array<{ id: string; content: string; source: string }>,
  resolvedClaims: ResolvedFieldValue[] = []
): MarketResearchReport {
  // 1. 过滤可用剂型，严禁包含 forbiddenForms
  const defaultForms = ["速溶茶粉", "茶包", "条包", "粉剂", "压片糖果"];
  const safeForms = defaultForms.filter((f) => !constraints.forbiddenForms.includes(f));
  const primaryForm = constraints.preferredForms.length > 0
    ? constraints.preferredForms[0]
    : (safeForms[0] || "速溶茶粉");
  const secondaryForm = safeForms.find((f) => f !== primaryForm) || "茶包";

  // 2. 基准价格设定
  const basePrice = constraints.targetPrice ||
    (constraints.minRetailPrice && constraints.maxRetailPrice
      ? (constraints.minRetailPrice + constraints.maxRetailPrice) / 2
      : 79.0);

  // 3. 构建标杆竞品（P1-01/C02/R2-03：只使用结构化的已核实 FACT 断言，禁止正则猜测虚构事实）
  const benchmarks: BenchmarkCompetitor[] = [];
  const evidenceGaps: string[] = [];

  const priceClaims = resolvedClaims.filter((c) => /price|retailPrice|salePrice|价格|售价|成交价/.test(c.fieldKey));
  const volumeClaims = resolvedClaims.filter((c) => /salesVolume|销量|月销/.test(c.fieldKey));

  if (resolvedClaims.length > 0) {
    // 仅基于已核实 FACT 断言，逐条产出可追溯的标杆竞品
    priceClaims.forEach((c, idx) => {
      // 规格说明：中标明单位与机制，防止单盒价与组合装价混算
      const specText = [c.spec, c.unit].filter(Boolean).join("/");
      const mechText = c.mechanism ? `(${c.mechanism})` : "";
      benchmarks.push({
        id: `bench-${c.evidenceId}`,
        name: `证据竞品 [${c.source}]${specText ? ` ${specText}` : ""}`,
        brand: c.source,
        price: parseFloat(c.value),
        salesVolumeDesc: "售价来源已核实断言，销量待核验",
        keyFeatures: ["售价取自结构化 FACT 断言（证据 ID 可追溯）"],
        consumerPainPoints: ["需进一步补充电商差评与用户实测留存数据"],
        evidenceRefId: c.evidenceId,
      });
    });
    if (priceClaims.length === 0) {
      evidenceGaps.push("已核实证据未覆盖竞品价格字段，缺少价格断言的来源细节");
    }
    if (volumeClaims.length === 0) {
      evidenceGaps.push("已核实证据未覆盖销量字段，销量判断需标记为待验证");
    }
  } else if (verifiedEvidenceSnippets.length > 0) {
    // 仅基于已核实证据片段提取结构化事实标杆（C02: 绝不臆测缺失价格）
    verifiedEvidenceSnippets.forEach((snippet) => {
      const priceMatch = snippet.content.match(/(?:¥|￥|单价|价格|售价|零售价)\s*([0-9]+(?:\.[0-9]+)?)/);
      const salesMatch = snippet.content.match(/(?:月销|销量|月销量)\s*([0-9]+[万\+kK\w~]*\s*(?:件|盒|包|条)?(?:\/月)?)/);

      const price = priceMatch ? parseFloat(priceMatch[1]) : null;
      const salesVolumeDesc = salesMatch ? salesMatch[1] : "资料未提供明确销量数据（待核验）";

      benchmarks.push({
        id: `bench-${snippet.id}`,
        name: `证据分析竞品 [${snippet.source}]`,
        brand: snippet.source,
        price,
        salesVolumeDesc,
        keyFeatures: ["源自核实材料提取", "配方/工艺证据比对"],
        consumerPainPoints: snippet.content.includes("差评") || snippet.content.includes("痛点")
          ? [snippet.content]
          : ["需进一步补充电商差评与用户实测留存数据"],
        evidenceRefId: snippet.id,
      });
    });
  } else {
    evidenceGaps.push("暂无已核实竞品结构化证据，已阻断事实标杆输出 (R2-03)");
  }

  // 4. 构建三条可比路线 (A/B/C)
  const routeA: FeasibleRoute = {
    routeCode: "ROUTE_A",
    title: `极致复购型·便携${primaryForm}`,
    dosageForm: primaryForm,
    positioning: "主打高性价比、日常高频口粮饮用，适合私域高复购与公域引流",
    keyIngredients: ["核心植物多酚提取物", "天然代糖(甜菊糖苷)", "速溶冷萃茶粉"],
    targetPrice: Number(basePrice.toFixed(2)),
    estimatedCost: Number((basePrice * 0.22).toFixed(2)), // 约 22% 目标成本
    pros: ["成本可控性极佳", "代工厂工艺成熟，打样周期短", "复购粘性高"],
    risks: ["毛利率空间受控，对达人佣金比例敏感"],
  };

  const routeB: FeasibleRoute = {
    routeCode: "ROUTE_B",
    title: `技术差异化·多酚锁鲜${secondaryForm}`,
    dosageForm: secondaryForm,
    positioning: "主打原产地原料锁鲜与纯净配方，适合高客单价礼品装与品质生活人群",
    keyIngredients: ["超微粉碎多酚原料", "天然冻干柠檬片", "草本滋养精萃"],
    targetPrice: Number((basePrice * 1.35).toFixed(2)),
    estimatedCost: Number((basePrice * 1.35 * 0.25).toFixed(2)),
    pros: ["溢价空间大，可支撑高佣金达人带货", "视觉与感官差异化显著"],
    risks: ["包材成本与相容性要求高，中试验证要求严格"],
  };

  const routeC: FeasibleRoute = {
    routeCode: "ROUTE_C",
    title: `草本复合·新中式调养概念`,
    dosageForm: primaryForm,
    positioning: "结合药食同源概念，主打轻养生与全天候润养场景",
    keyIngredients: ["植物多酚复合基底", "枸杞提取物", "茯苓超微粉"],
    targetPrice: Number((basePrice * 1.1).toFixed(2)),
    estimatedCost: Number((basePrice * 1.1 * 0.23).toFixed(2)),
    pros: ["契合新中式养生风口", "口味包容度好"],
    risks: ["法规合规与宣称边界需严格把关，需避免触碰禁止宣称"],
  };

  const validEvidencePrices = benchmarks.map((b) => b.price).filter((p): p is number => p !== null);
  const priceBandsSummary =
    validEvidencePrices.length > 0
      ? `基于已核实竞品证据，实际市场抽样价格为 ¥${Math.min(...validEvidencePrices).toFixed(2)} - ¥${Math.max(...validEvidencePrices).toFixed(2)}。`
      : `已核实材料未包含有效竞品成交价格，市场实际价格带处于待验证状态（基准参考目标价 ¥${basePrice.toFixed(2)}）。`;

  // 5. C02/R2-03: 明确区分「有证据支撑」与「规则模板推断」的结论，报告整体标记为待验证草案
  const evidencedSections: string[] = [];
  const inferredSections: string[] = [];

  if (benchmarks.length > 0) {
    evidencedSections.push(`benchmarks: ${benchmarks.length} 条标杆竞品逐条来自已核实证据原文（证据 ID 可追溯）`);
    if (validEvidencePrices.length > 0) {
      evidencedSections.push("marketInsights.priceBandsSummary: 价格带由已核实证据中的成交价计算");
    } else {
      inferredSections.push("marketInsights.priceBandsSummary: 已核实证据未包含成交价，价格带处于待验证状态，仅保留目标价推算基准");
    }
  } else {
    inferredSections.push("benchmarks: 无已核实证据，未生成任何事实标杆 (R2-03)");
  }

  inferredSections.push(
    "marketInsights.overview: 类目趋势为规则模板推断，尚无外部研究或一手资料支撑",
    "marketInsights.painPoints: 除证据原文引用外为模板推断，尚待电商差评与实测数据验证",
    "candidateRoutes[].keyIngredients / targetPrice / estimatedCost / pros / risks: 由目标价与剂型约束推导，未经工厂报价、渠道成交价或技术可行性核实",
    "recommendedRouteCode / selectionRationale: 规则默认推荐，未经人工选型确认"
  );

  const verification: ResearchVerification = {
    status: evidencedSections.length > 0 ? "PARTIALLY_EVIDENCED" : "DRAFT_UNVERIFIED",
    evidencedSections,
    inferredSections,
    notes: [
      "本报告为待验证草案，不得直接作为打样门批准的唯一依据：仅 evidencedSections 列出的部分有已核实证据支撑。",
      "inferredSections 列出的结论须补充外部研究、工厂报价或人工核实后，方可升级为正式研究报告。",
    ],
  };

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    categoryName,
    marketInsights: {
      overview: `【待验证草案·模板推断】针对 ${categoryName} 类目，系统按规则模板推断当前市场正由“传统冲饮”向“纯净配方、高有效成分留存”升级；该结论尚无外部研究数据支撑，需补充证据后确认。`,
      painPoints: [
        ...evidenceGaps,
        "【模板推断·待验证】消费者对人工香精、人工甜味剂有明显排斥",
        "【模板推断·待验证】冲调时溶解度不佳、易出现团聚物",
        "【模板推断·待验证】功效宣称模糊或过度夸大，缺乏权威第三方检测报告支撑",
      ],
      priceBandsSummary,
    },
    benchmarks,
    candidateRoutes: [routeA, routeB, routeC],
    recommendedRouteCode: "ROUTE_A",
    selectionRationale:
      "【规则默认推荐·待验证】路线 A 为按目标价与剂型约束推导的默认选型，避开了被禁止的宣称与剂型；成本红线契合度、工厂量产可行性均未经外部数据或人工选型确认，需补证后确认。",
    verification,
    // P1-02：基于同一证据洞察合成机会分析（机会类型/八要素，三态分列；不做正则猜测）
    opportunityAnalysis: synthesizeOpportunityAnalysis(
      { resolved: resolvedClaims, gaps: computeEvidenceGaps(resolvedClaims.map((c) => c.fieldKey)) },
      constraints
    ),
  };
}
