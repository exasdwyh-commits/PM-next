/**
 * Kern Role Intelligence
 * ======================
 * Kern 作为高智能主Agent，统筹一切。它需要根据实际情况自动判断用户角色和输出形式。
 * 
 * 本模块是纯函数，不依赖DB，前后端同构，可被 harness 测试。
 * 
 * 三种切换方式：
 * 1. 自动：根据文本、页面、行为智能识别
 * 2. 手动：用户点击 RoleSwitcher
 * 3. Kern对话驱动：用户说"切换到销售视角"或 Kern 在 envelope 中建议
 */

export type UserRole = "leadership" | "product" | "sales";
export type RoleSource = "manual" | "auto" | "kern" | "default";

export interface RoleInference {
  role: UserRole;
  source: RoleSource;
  confidence: number; // 0-1
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
  // English
  { pattern: /switch to (leadership|executive|management)/i, role: "leadership" },
  { pattern: /switch to (product|engineering|technical|rd)/i, role: "product" },
  { pattern: /switch to (sales|marketing)/i, role: "sales" },
];

const PAGE_ROLE_MAP: Record<string, UserRole> = {
  "overview": "leadership",
  "decisions": "leadership",
  "tasks": "product",
  "evidence": "product",
  "rnd": "product",
  "knowledge": "product",
  "marketing": "sales",
  "cost": "product",
  "launch": "sales",
};

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

export function inferRoleFromPage(pageContext: string): RoleInference | null {
  const ctx = pageContext.toLowerCase();
  for (const [key, role] of Object.entries(PAGE_ROLE_MAP)) {
    if (ctx.includes(key)) {
      return { role, source: "auto", confidence: 0.6, reason: `页面上下文 ${key}` };
    }
  }
  return null;
}

export function inferRoleFromEnvelope(envelope: any): RoleInference | null {
  // Kern 可以在 envelope.meta 中建议角色
  if (!envelope) return null;
  
  // 检查自定义字段
  const suggested = envelope.meta?.suggestedRole || envelope.meta?.audience || envelope.suggestedRole || envelope.audience;
  if (suggested && ["leadership", "product", "sales"].includes(suggested)) {
    return { role: suggested as UserRole, source: "kern", confidence: 0.9, reason: "Kern 建议的角色" };
  }

  // 根据 envelope.kind 推断
  if (envelope.kind === "CONCLUSION") {
    // 决策类默认领导，但如果有详细证据可能是产品
    const hasEvidence = envelope.blocks?.some((b: any) => b.type === "evidence" || b.type === "checklist" || b.type === "timeline");
    const hasSales = envelope.blocks?.some((b: any) => 
      JSON.stringify(b).includes("卖点") || JSON.stringify(b).includes("竞品") || JSON.stringify(b).includes("客户价值")
    );
    if (hasSales) return { role: "sales", source: "auto", confidence: 0.65, reason: "包含销售卖点" };
    if (hasEvidence) return { role: "product", source: "auto", confidence: 0.6, reason: "包含详细证据/清单" };
    return { role: "leadership", source: "auto", confidence: 0.55, reason: "决策结论默认领导视角" };
  }

  // 根据 lede 和 blocks 内容推断
  const text = JSON.stringify(envelope).toLowerCase();
  return inferRoleFromText(text);
}

export function resolveEffectiveRole(inputs: {
  manualRole: { role: UserRole; at: number } | null;
  kernRole: { role: UserRole; at: number; reason: string } | null;
  autoRoles: RoleInference[];
  defaultRole: UserRole;
}): { role: UserRole; source: RoleSource; reason: string; confidence: number } {
  const now = Date.now();
  const MANUAL_TTL = 30 * 60 * 1000; // 30分钟内手动优先
  const KERN_TTL = 10 * 60 * 1000; // 10分钟内Kern建议优先

  // 1. 手动设置在TTL内最优先
  if (inputs.manualRole && now - inputs.manualRole.at < MANUAL_TTL) {
    return { role: inputs.manualRole.role, source: "manual", reason: "用户手动选择", confidence: 1 };
  }

  // 2. Kern 建议在TTL内次优先
  if (inputs.kernRole && now - inputs.kernRole.at < KERN_TTL) {
    return { role: inputs.kernRole.role, source: "kern", reason: inputs.kernRole.reason, confidence: 0.9 };
  }

  // 3. 自动识别，取最高置信度
  if (inputs.autoRoles.length > 0) {
    const sorted = [...inputs.autoRoles].sort((a, b) => b.confidence - a.confidence);
    const top = sorted[0];
    if (top.confidence > 0.5) {
      return { role: top.role, source: top.source, reason: top.reason, confidence: top.confidence };
    }
  }

  // 4. 默认
  return { role: inputs.defaultRole, source: "default", reason: "默认角色", confidence: 0.3 };
}

// Kern 自身需求分析：Kern 需要什么来做好角色适配
export const KERN_NEEDS = {
  context: [
    "用户角色偏好（历史选择）",
    "当前页面上下文（总览/证据/营销）",
    "对话意图（问卖点 vs 问证据）",
    "组织角色（OrgRole）",
    "项目阶段（立项/研发/上市）",
  ],
  capabilities: [
    "调用证据溯源工具获取可信度",
    "调用成本计算器获取利润空间",
    "调用市场分析获取增长数据",
    "调用包装合规检查",
    "调用PPT/Word生成器",
    "调用竞品对比分析",
  ],
  outputAdaptation: [
    "领导层：压缩信息，一句话结论+KPI卡片+图表，10秒决策",
    "产品研发：展开细节，表格+溯源+验证计划+QA轨迹，工具流程丰富",
    "销售营销：提炼卖点，客户价值映射+竞品高亮+一键生成工具",
  ],
  coordination: [
    "Kern作为主Agent，根据用户角色自动选择调用哪些专业Agent",
    "领导问 → Kern直接综合，不展开细节",
    "产品问 → Kern调用research_agent, scientific_evidence_agent, qa_verifier",
    "销售问 → Kern调用marketing_agent, research_agent, cost_bom_agent",
    "输出时，Kern在 envelope.meta.suggestedRole 中标记建议角色，前端自动切换",
  ],
};
