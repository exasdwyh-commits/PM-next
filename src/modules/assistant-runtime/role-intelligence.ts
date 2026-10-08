/**
 * Kern Role Intelligence - Backend
 * ================================
 * Server-side version of role detection, used by collaboration planner and context builder
 * Pure functions, isomorphic with frontend kern-role-intelligence.ts
 */

export type UserRole = "leadership" | "product" | "sales";
export type RoleSource = "manual" | "auto" | "kern" | "default";

export interface RoleInference {
  role: UserRole;
  source: RoleSource;
  confidence: number;
  reason: string;
}

const LEADERSHIP_KEYWORDS = [
  "领导", "老板", "总结", "一页", "决策", "拍板", "结论", "概览", "总览",
  "直观", "简单", "快速", "10秒", "一句话", "KPI", "看懂", "汇报",
  "进度", "状态", "现在怎么样", "怎么样了", "需要我做什么"
];

const PRODUCT_KEYWORDS = [
  "证据", "研发", "技术", "验证", "溯源", "来源", "可信度", "A级", "B级",
  "QA", "轨迹", "红队", "推断", "事实", "UNKNOWN", "缺口", "风险", "合规",
  "成本", "配方", "剂量", "多酚", "留存率", "实验室", "核验", "检查",
  "依赖", "工作项", "时间线", "清单", "机制", "论文", "临床"
];

const SALES_KEYWORDS = [
  "卖点", "销售", "客户", "话术", "竞品", "对比", "报价", "PPT", "Word",
  "市场", "营销", "价值", "利润", "成本优势", "一键生成", "销售支撑",
  "购买", "成交", "转化", "增长", "趋势", "机会", "案例", "脚本"
];

const ROLE_SWITCH_PATTERNS: { pattern: RegExp; role: UserRole }[] = [
  { pattern: /(切换到|切到|改为|改成|用).{0,6}(领导|老板|直观|管理层|高管)/i, role: "leadership" },
  { pattern: /(切换到|切到|改为|改成|用).{0,6}(产品|研发|技术|专业|严谨|工程师)/i, role: "product" },
  { pattern: /(切换到|切到|改为|改成|用).{0,6}(销售|营销|卖点|客户|市场)/i, role: "sales" },
  { pattern: /(领导|老板)视角|管理层视角|直观模式/i, role: "leadership" },
  { pattern: /(产品|研发|技术)视角|专业模式|严谨模式|工程师视角/i, role: "product" },
  { pattern: /(销售|营销|卖点)视角|销售模式|客户视角/i, role: "sales" },
];

export function detectRoleSwitchIntent(text: string): UserRole | null {
  const t = text.trim();
  for (const { pattern, role } of ROLE_SWITCH_PATTERNS) {
    if (pattern.test(t)) return role;
  }
  return null;
}

export function inferRoleFromText(text: string): RoleInference | null {
  const t = text.toLowerCase();
  let leadershipScore = 0;
  let productScore = 0;
  let salesScore = 0;

  for (const kw of LEADERSHIP_KEYWORDS) if (t.includes(kw.toLowerCase())) leadershipScore++;
  for (const kw of PRODUCT_KEYWORDS) if (t.includes(kw.toLowerCase())) productScore++;
  for (const kw of SALES_KEYWORDS) if (t.includes(kw.toLowerCase())) salesScore++;

  const total = leadershipScore + productScore + salesScore;
  if (total === 0) return null;

  const max = Math.max(leadershipScore, productScore, salesScore);
  const confidence = Math.min(0.95, max / Math.max(3, total) + 0.2);

  if (max === leadershipScore) {
    return { role: "leadership", source: "auto", confidence, reason: `匹配领导关键词 ${leadershipScore}个` };
  }
  if (max === productScore) {
    return { role: "product", source: "auto", confidence, reason: `匹配研发关键词 ${productScore}个` };
  }
  return { role: "sales", source: "auto", confidence, reason: `匹配销售关键词 ${salesScore}个` };
}

export function inferRoleFromEnvelope(envelope: any): RoleInference | null {
  if (!envelope) return null;
  const suggested = envelope.meta?.suggestedRole || envelope.meta?.audience || envelope.suggestedRole || envelope.audience;
  if (suggested && ["leadership", "product", "sales"].includes(suggested)) {
    return { role: suggested as UserRole, source: "kern", confidence: 0.9, reason: "Kern 建议的角色" };
  }
  return null;
}

// 根据角色选择专家
export function expertsForRole(role: UserRole): string[] {
  switch (role) {
    case "leadership":
      // 领导层：直接综合，少量专家
      return ["product_agent"];
    case "product":
      // 产品研发：全量专家，严谨
      return ["research_agent", "scientific_evidence_agent", "formulation_agent", "compliance_agent", "cost_bom_agent", "qa_verifier"];
    case "sales":
      // 销售营销：市场+成本+产品
      return ["research_agent", "product_agent", "cost_bom_agent", "marketing_agent"];
    default:
      return [];
  }
}

export function collaborationModeForRole(role: UserRole): string {
  switch (role) {
    case "leadership":
      return "SOLO"; // 直接给结论
    case "product":
      return "COUNCIL"; // 多专家会诊
    case "sales":
      return "PAIR"; // 市场+产品
    default:
      return "SOLO";
  }
}
