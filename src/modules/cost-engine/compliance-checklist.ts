/**
 * Compliance Checklist - 4类合规清单
 * 普通食品、保健食品、跨境食品、化妆品
 */

export interface ComplianceItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  category: string;
  estimatedCost?: number; // 预估费用
  estimatedDays?: number; // 预估天数
  status?: "pending" | "done" | "na";
  evidenceRef?: string;
}

export const COMPLIANCE_CHECKLISTS: Record<string, ComplianceItem[]> = {
  regular_food: [
    { id: "sc", label: "SC食品生产许可", description: "食品生产许可证，代工厂需有", required: true, category: "生产许可", estimatedCost: 0, estimatedDays: 0 },
    { id: "label", label: "标签审核", description: "GB 7718标签合规，配料表、营养成分表", required: true, category: "标签", estimatedCost: 500, estimatedDays: 3 },
    { id: "inspection", label: "出厂检验", description: "每批出厂检验报告", required: true, category: "检测", estimatedCost: 800, estimatedDays: 5 },
    { id: "shelf_life", label: "保质期测试", description: "保质期验证", required: false, category: "检测", estimatedCost: 2000, estimatedDays: 30 },
  ],
  health_food: [
    { id: "filing", label: "保健食品备案", description: "国产保健食品备案，5-8万，3-6月", required: true, category: "备案", estimatedCost: 60000, estimatedDays: 120 },
    { id: "registration", label: "保健食品注册(蓝帽)", description: "蓝帽子注册，20-50万，1-2年，功能声称", required: false, category: "注册", estimatedCost: 300000, estimatedDays: 400 },
    { id: "function_test", label: "功能性检测", description: "保健功能检测，如抗氧化、增强免疫", required: true, category: "检测", estimatedCost: 15000, estimatedDays: 30 },
    { id: "stability", label: "稳定性测试", description: "加速/长期稳定性，验证保质期", required: true, category: "检测", estimatedCost: 10000, estimatedDays: 90 },
    { id: "safety", label: "安全性检测", description: "毒理、卫生学检测", required: true, category: "检测", estimatedCost: 8000, estimatedDays: 20 },
    { id: "label", label: "标签+说明书", description: "保健食品标签、说明书审核，含蓝帽标识", required: true, category: "标签", estimatedCost: 1000, estimatedDays: 5 },
    { id: "gmp", label: "GMP车间", description: "保健食品GMP生产车间", required: true, category: "生产", estimatedCost: 0, estimatedDays: 0 },
  ],
  cross_border_food: [
    { id: "import_filing", label: "进口食品备案", description: "进口食品收货人备案", required: true, category: "备案", estimatedCost: 2000, estimatedDays: 10 },
    { id: "overseas", label: "境外生产企业注册", description: "海关总署境外生产企业注册", required: true, category: "注册", estimatedCost: 3000, estimatedDays: 20 },
    { id: "chinese_label", label: "中文标签备案", description: "进口食品中文标签设计+备案", required: true, category: "标签", estimatedCost: 1500, estimatedDays: 7 },
    { id: "tariff", label: "关税+增值税", description: "关税10-15% + 增值税13%", required: true, category: "税费", estimatedCost: 0, estimatedDays: 0 },
    { id: "clearance", label: "清关+报关", description: "报关、清关代理", required: true, category: "物流", estimatedCost: 2000, estimatedDays: 3 },
    { id: "inspection", label: "入境检验检疫", description: "海关检验检疫", required: true, category: "检测", estimatedCost: 1000, estimatedDays: 5 },
    { id: "bonded", label: "保税仓", description: "保税仓存储，跨境电商模式", required: false, category: "仓储", estimatedCost: 500, estimatedDays: 0 },
    { id: "positive_list", label: "正面清单", description: "跨境电商正面清单内", required: true, category: "合规", estimatedCost: 0, estimatedDays: 0 },
  ],
  cosmetics: [
    { id: "filing", label: "化妆品备案", description: "普通化妆品备案，3-5万，1-3月", required: true, category: "备案", estimatedCost: 40000, estimatedDays: 60 },
    { id: "registration", label: "特殊化妆品注册", description: "特殊化妆品(美白、防晒等)注册，5-10万，6-12月", required: false, category: "注册", estimatedCost: 80000, estimatedDays: 200 },
    { id: "safety", label: "安全评估", description: "化妆品安全评估报告", required: true, category: "检测", estimatedCost: 8000, estimatedDays: 15 },
    { id: "efficacy", label: "功效评价", description: "功效宣称评价，如保湿、美白", required: true, category: "检测", estimatedCost: 12000, estimatedDays: 30 },
    { id: "micro", label: "微生物+重金属", description: "微生物、重金属、防腐剂检测", required: true, category: "检测", estimatedCost: 2000, estimatedDays: 7 },
    { id: "label", label: "标签审核", description: "化妆品标签审核，成分表、宣称", required: true, category: "标签", estimatedCost: 800, estimatedDays: 3 },
    { id: "gmp", label: "化妆品GMP", description: "化妆品生产质量管理规范", required: true, category: "生产", estimatedCost: 0, estimatedDays: 0 },
  ],
};

export function getComplianceChecklist(category: string): ComplianceItem[] {
  return COMPLIANCE_CHECKLISTS[category] || COMPLIANCE_CHECKLISTS.regular_food;
}

export function calculateComplianceCost(category: string): { totalCost: number; totalDays: number; requiredCount: number; optionalCount: number } {
  const checklist = getComplianceChecklist(category);
  let totalCost = 0;
  let totalDays = 0;
  let requiredCount = 0;
  let optionalCount = 0;

  for (const item of checklist) {
    if (item.required) {
      requiredCount++;
      totalCost += item.estimatedCost || 0;
      totalDays = Math.max(totalDays, item.estimatedDays || 0); // 并行，取最大
    } else {
      optionalCount++;
    }
  }

  return { totalCost, totalDays, requiredCount, optionalCount };
}

export function getComplianceForRole(category: string, role: "leadership" | "product" | "sales" | "operator"): ComplianceItem[] {
  const all = getComplianceChecklist(category);
  if (role === "leadership") {
    // 领导只看必需项
    return all.filter(item => item.required).slice(0, 3);
  }
  if (role === "sales") {
    // 销售只看标签和宣称
    return all.filter(item => item.category === "标签" || item.label.includes("宣称") || item.label.includes("标签"));
  }
  // 产品看全部
  return all;
}
