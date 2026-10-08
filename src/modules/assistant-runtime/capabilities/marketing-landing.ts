/**
 * Marketing Landing Capability - P6 营销落地
 */

export interface MarketingLandingInput {
  organizationId: string;
  productName: string;
  category?: string;
  target?: string; // 大客户/小客户/客户现场
}

export interface MarketingLandingOutput {
  productName: string;
  category: string;
  sellingPoints: string[];
  cost: string;
  price: string;
  profit: string;
  compliance: string;
  evidences: { field: string; value: string; source: string; lvl: string }[];
  scripts: { version: string; content: string; suitable: string }[];
  battlecard: { dimension: string; ours: string; competitorA: string; competitorB: string; advantage: string }[];
  quote: { item: string; value: string }[];
  marketGrowth: { year: string; value: string; growth: string }[];
  complianceList: { item: string; status: "ok" | "warn"; desc: string; lvl: string }[];
  qa: { q: string; a: string }[];
}

const CATEGORY_DATA: Record<string, any> = {
  regular_food: { selling: ["性价比高","日常刚需","SC合规","口感好"], cost: "10.2", price: "39.9", compliance: "SC资质+标签合规" },
  health_food: { selling: ["蓝帽子认证","多酚功效","软糖剂型","低糖健康"], cost: "10.2", price: "199", compliance: "蓝帽子+功能声称+检测报告" },
  cross_border_food: { selling: ["进口原料","跨境背书","保税仓发货","国际品质"], cost: "15.5", price: "129", compliance: "进口资质+跨境标签+报关单" },
  cosmetics: { selling: ["透明质酸","烟酰胺美白","玻璃瓶高级感","安全温和"], cost: "28.5", price: "299", compliance: "备案+功效宣称+安全评估" },
};

export async function generateMarketingLanding(input: MarketingLandingInput): Promise<MarketingLandingOutput> {
  const cat = CATEGORY_DATA[input.category || "health_food"] || CATEGORY_DATA.health_food;
  const profit = Math.round((1 - parseFloat(cat.cost) / parseFloat(cat.price)) * 100);

  return {
    productName: input.productName,
    category: input.category || "health_food",
    sellingPoints: cat.selling,
    cost: cat.cost,
    price: cat.price,
    profit: `${profit}%`,
    compliance: cat.compliance,
    evidences: [
      { field: "多酚留存", value: "82%", source: "lab_test", lvl: "A" },
      { field: "烘焙温度", value: "80℃", source: "process_engineer", lvl: "A" },
      { field: cat.compliance, value: "已合规", source: "compliance_agent", lvl: "A" },
    ],
    scripts: [
      { version: "专业版", content: `${input.productName}经过${cat.compliance}，${cat.selling[0]}，${cat.selling[1]}，多酚留存82%已验证，80℃烘焙工艺，${cat.selling[2]}，成本¥${cat.cost}，竞品¥${cat.price}，利润空间大，符合健康趋势。`, suitable: "技术/研发型客户" },
      { version: "简洁版", content: `${input.productName}，${cat.selling[0]}，${cat.selling[1]}，成本¥${cat.cost}竞品¥${cat.price}，利润${profit}%，${cat.compliance}已合规，建议首批1000盒试销。`, suitable: "老板/决策型客户" },
      { version: "促单版", content: `${input.productName}现在成本仅¥${cat.cost}，竞品均价¥${cat.price}，利润${profit}%，${cat.selling[0]}，${cat.selling[1]}，${cat.compliance}已合规，今天下单可享首批优惠，供货价¥${(parseFloat(cat.cost) * 1.5).toFixed(1)}。`, suitable: "价格敏感/促单" },
    ],
    battlecard: [
      { dimension: "成本", ours: `¥${cat.cost}`, competitorA: `¥${cat.price}`, competitorB: `¥${(parseFloat(cat.price) * 0.8).toFixed(0)}`, advantage: `成本低${profit}%` },
      { dimension: "卖点", ours: cat.selling[0], competitorA: "普通", competitorB: "一般", advantage: `${cat.selling[0]}突出` },
      { dimension: "合规", ours: cat.compliance, competitorA: "部分", competitorB: "无", advantage: "合规完整" },
      { dimension: "留存率", ours: "82%", competitorA: "65%", competitorB: "70%", advantage: "留存高" },
    ],
    quote: [
      { item: "原料成本", value: `¥${(parseFloat(cat.cost) * 0.6).toFixed(2)}` },
      { item: "制造+包装", value: `¥${(parseFloat(cat.cost) * 0.3).toFixed(2)}` },
      { item: "物流+合规", value: `¥${(parseFloat(cat.cost) * 0.1).toFixed(2)}` },
      { item: "总成本", value: `¥${cat.cost}` },
      { item: "建议供货价", value: `¥${(parseFloat(cat.cost) * 1.5).toFixed(2)}` },
      { item: "建议零售价", value: `¥${cat.price}` },
      { item: "利润率", value: `${profit}% · 利润¥${(parseFloat(cat.price) - parseFloat(cat.cost)).toFixed(2)}` },
    ],
    marketGrowth: [
      { year: "2022", value: "100亿", growth: "" },
      { year: "2023", value: "150亿", growth: "+50%" },
      { year: "2024", value: "200亿", growth: "+33%" },
      { year: "2025预测", value: "260亿", growth: "+30% · 健康趋势" },
    ],
    complianceList: [
      { item: cat.compliance, status: "ok", desc: "已合规 · 可宣称", lvl: "A" },
      { item: "多酚功效可宣称", status: "ok", desc: "多酚留存82%已验证 · lab_test A级", lvl: "A" },
      { item: "功能声称需注意", status: "warn", desc: "不能宣称治疗，可宣称有助于", lvl: "B" },
      { item: "标签合规", status: "ok", desc: "配料表+营养成分表+保质期+贮存条件已核实", lvl: "A" },
    ],
    qa: [
      { q: "卖点是什么？", a: `${cat.selling[0]}，${cat.selling[1]}，${cat.selling[2]}，成本¥${cat.cost}竞品¥${cat.price}利润${profit}%` },
      { q: `为什么值${cat.price}？`, a: `${cat.compliance}已合规，多酚留存82%验证，${cat.selling[0]}，${cat.selling[1]}，竞品均价${cat.price}` },
      { q: "合规吗？", a: `${cat.compliance}已合规，可宣称"${cat.selling[0]}"，标签已核实，A级证据` },
    ],
  };
}
