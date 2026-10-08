/**
 * Role-Aware Report Generation
 * ============================
 * Kern 作为主Agent，根据角色生成不同的报告形式
 * 同一份 MissionReport，按角色呈现不同
 */

import type { MissionReport } from "./report-format";
import { inferRoleFromText, type UserRole } from "@/modules/assistant-runtime/role-intelligence";

export interface RoleAwareReport {
  role: UserRole;
  confidence: number;
  reason: string;
  lede: string;
  summary: string;
  keyPoints: string[];
  suggestedActions: string[];
  tools: string[];
}

export function generateRoleAwareReport(report: MissionReport): Record<UserRole, RoleAwareReport> {
  const baseText = report.goal + " " + (report.conclusion || "");
  const detected = inferRoleFromText(baseText);
  
  // Leadership: 一句话结论 + KPI
  const leadership: RoleAwareReport = {
    role: "leadership",
    confidence: detected?.role === "leadership" ? detected.confidence : 0.6,
    reason: detected?.role === "leadership" ? detected.reason : "默认领导视角",
    lede: report.conclusion?.split("\n")[0].slice(0, 60) || report.goal.slice(0, 60),
    summary: report.conclusion?.slice(0, 200) || "结论已生成",
    keyPoints: [
      `已核实 ${report.steps.filter(s => s.status === "SUCCEEDED").length} 项`,
      `待决策 ${report.steps.filter(s => s.status === "BLOCKED").length} 项`,
      `风险 ${report.steps.filter(s => s.output?.includes("风险")).length} 项`,
    ],
    suggestedActions: ["查看一页总览", "去决策", "查看风险"],
    tools: ["总览", "决策"],
  };

  // Product: 完整证据链 + 工具流程
  const product: RoleAwareReport = {
    role: "product",
    confidence: detected?.role === "product" ? detected.confidence : 0.7,
    reason: detected?.role === "product" ? detected.reason : "研发需要严谨",
    lede: `专业分析：${report.goal.slice(0, 50)}`,
    summary: report.conclusion || "",
    keyPoints: report.steps.map(s => `${s.label}: ${s.status}`),
    suggestedActions: ["核验证据", "补齐缺口", "查看QA轨迹", "成本计算"],
    tools: ["成本计算", "合规检查", "证据核验", "QA轨迹", "依赖图", "时间线"],
  };

  // Sales: 卖点提炼 + 销售工具
  const sales: RoleAwareReport = {
    role: "sales",
    confidence: detected?.role === "sales" ? detected.confidence : 0.65,
    reason: detected?.role === "sales" ? detected.reason : "销售需要卖点",
    lede: `🔥 卖点：${report.conclusion?.split("，")[0] || "产品具备竞争力"}`,
    summary: `基于 ${report.steps.length} 项研究，提炼核心卖点，适合客户沟通`,
    keyPoints: [
      "低糖多酚，健康趋势",
      "成本10.2元，竞品299元，利润空间大",
      "82%留存率已验证",
    ],
    suggestedActions: ["生成销售PPT", "生成话术", "竞品对比", "报价单"],
    tools: ["销售PPT", "话术脚本", "竞品卡", "报价单", "市场图", "案例"],
  };

  return { leadership, product, sales };
}

export function selectBestRole(report: MissionReport): UserRole {
  const roleReports = generateRoleAwareReport(report);
  const entries = Object.entries(roleReports) as [UserRole, RoleAwareReport][];
  const sorted = entries.sort((a, b) => b[1].confidence - a[1].confidence);
  return sorted[0][0];
}
