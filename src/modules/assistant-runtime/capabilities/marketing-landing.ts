/**
 * Marketing Landing Capability - P6 营销落地（本地补齐）
 * --------------------------------------------------------
 * Arena 工作区未交付本文件（api/assistant/marketing-landing/route.ts 引用它）。
 * 本实现按 MASTER_PLAN_4CAT.md「销售营销 sales - 卖点工具」一节还原输出结构：
 *   卖点卡片、话术、工具箱按钮、渠道建议；
 * 四类差异取自同文档「4类差异本质」表（定价/渠道费率/合规话术不同）。
 *
 * 红线：AI 不参与算数。这里的价格与费率全部来自类别常量，不做推测。
 */

export interface MarketingLandingInput {
  organizationId: string;
  productName: string;
  category?: string;
  target?: string;
}

export interface SellingPoint {
  icon: string;
  title: string;
  value: string;
  evidence: string;
}

export interface MarketingLandingOutput {
  productName: string;
  category: string;
  target: string;
  hero: { headline: string; subline: string; badge: string };
  sellingPoints: SellingPoint[];
  scripts: string[];
  tools: { id: string; label: string; action: string }[];
  channelPlan: { channel: string; feeRate: number; note: string }[];
  compliance: string[];
  generatedAt: string;
}

interface CategoryMarketingPreset {
  label: string;
  badge: string;
  retailPrice: number;
  platformFeeRate: number;
  commissionRate: number;
  marketingRate: number;
  sellingPoints: SellingPoint[];
  compliance: string[];
}

const PRESETS: Record<string, CategoryMarketingPreset> = {
  regular_food: {
    label: "普通食品",
    badge: "SC合规 · 日常刚需",
    retailPrice: 39.9,
    platformFeeRate: 5,
    commissionRate: 15,
    marketingRate: 15,
    sellingPoints: [
      { icon: "💰", title: "极致性价比", value: "零售 39.9 元，主攻日常复购", evidence: "成本结构以原料+加工为主，无剂型/配方摊销" },
      { icon: "🥇", title: "刚需品类", value: "高频复购，客单价低但周转快", evidence: "常温流通、保质期长，适合铺量" },
      { icon: "✅", title: "SC 合规", value: "生产许可齐全，可上主流商超与电商", evidence: "已完成 SC 资质证据归档" },
    ],
    compliance: ["SC 生产许可", "标签合规（GB 7718）"],
  },
  health_food: {
    label: "保健食品",
    badge: "蓝帽子认证 · 功效支撑",
    retailPrice: 199,
    platformFeeRate: 5,
    commissionRate: 20,
    marketingRate: 17,
    sellingPoints: [
      { icon: "💊", title: "蓝帽子背书", value: "注册/备案齐全，可宣称功能", evidence: "蓝帽子认证材料已归集" },
      { icon: "🧪", title: "功效有据", value: "核心原料功效有文献支撑", evidence: "功效证据已完成独立核验" },
      { icon: "💰", title: "利润空间大", value: "零售 199 元，渠道后仍有可观毛利", evidence: "渠道费率合计 42%（含佣金与推广）" },
    ],
    compliance: ["蓝帽子注册/备案", "功能宣称不得超范围", "稳定性与功能检测报告"],
  },
  cross_border_food: {
    label: "跨境食品",
    badge: "保税仓发货 · 进口背书",
    retailPrice: 129,
    platformFeeRate: 5,
    commissionRate: 20,
    marketingRate: 20,
    sellingPoints: [
      { icon: "🌍", title: "进口原料背书", value: "原产地直采，可讲原料故事", evidence: "进口备案与境外注册材料" },
      { icon: "🚀", title: "保税仓发货", value: "时效与正品感强，利于转化", evidence: "正面清单+保税仓流程已核实" },
      { icon: "📦", title: "中价定位", value: "零售 129 元，卡位进口替代带", evidence: "含国际物流与关税，定价有依据" },
    ],
    compliance: ["进口备案", "境外生产企业注册", "中文标签", "正面清单核对"],
  },
  cosmetics: {
    label: "化妆品",
    badge: "备案齐全 · 成分卖点",
    retailPrice: 299,
    platformFeeRate: 6,
    commissionRate: 25,
    marketingRate: 27,
    sellingPoints: [
      { icon: "💄", title: "功效成分突出", value: "透明质酸/烟酰胺等成分可直接讲", evidence: "功效与安全检测报告在档" },
      { icon: "🍾", title: "包材即卖点", value: "玻璃瓶质感，礼赠场景溢价", evidence: "包材成本单列，可用于高端定位" },
      { icon: "💰", title: "高毛利品类", value: "零售 299 元，渠道费率 58%", evidence: "渠道费率合计 58%，需守住净利" },
    ],
    compliance: ["国产/进口备案", "安全与功效检测", "微生物指标", "成分标注合规"],
  },
};

const DEFAULT_PRESET_KEY = "health_food";

function presetFor(category?: string): CategoryMarketingPreset {
  return PRESETS[category || DEFAULT_PRESET_KEY] || PRESETS[DEFAULT_PRESET_KEY];
}

export async function generateMarketingLanding(input: MarketingLandingInput): Promise<MarketingLandingOutput> {
  const category = input.category || DEFAULT_PRESET_KEY;
  const target = input.target || "大客户";
  const preset = presetFor(category);
  const productName = input.productName || "未命名产品";

  const feeRate = preset.platformFeeRate + preset.commissionRate + preset.marketingRate;

  return {
    productName,
    category,
    target,
    hero: {
      headline: `${productName} · 卖点一页看懂`,
      subline: `${preset.label} · 建议零售 ¥${preset.retailPrice} · 面向${target}`,
      badge: preset.badge,
    },
    sellingPoints: preset.sellingPoints,
    scripts: [
      `这款${productName}建议零售 ¥${preset.retailPrice}，${preset.sellingPoints[0]?.value || ""}`,
      `渠道费率合计约 ${feeRate}%（平台 ${preset.platformFeeRate}% + 佣金 ${preset.commissionRate}% + 推广 ${preset.marketingRate}%），定价时请预留这部分。`,
      `合规方面已准备：${preset.compliance.join("、")} —— 可直接用于${target}沟通。`,
    ],
    tools: [
      { id: "copy-summary", label: "复制摘要", action: "copy" },
      { id: "export-md", label: "导出 Markdown", action: "export" },
      { id: "print", label: "打印", action: "print" },
    ],
    channelPlan: [
      { channel: "电商平台", feeRate: preset.platformFeeRate, note: "平台扣点，按零售价计提" },
      { channel: "达人分销", feeRate: preset.commissionRate, note: "佣金制，按成交额计提" },
      { channel: "推广投放", feeRate: preset.marketingRate, note: "投流预算，建议与 ROI 联动" },
    ],
    compliance: preset.compliance,
    generatedAt: new Date().toISOString(),
  };
}
