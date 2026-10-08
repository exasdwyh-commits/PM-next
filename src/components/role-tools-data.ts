/**
 * 角色工具定义（从 role-tools.tsx 抽出）
 * --------------------------------------
 * 原 `ToolDef` 与 `ALL_TOOLS` 定义在 role-tools.tsx 内部且未导出，
 * 而 role-tools.tsx 又要 import 尚未交付的 `role-tools-rich`。
 * 两条线都要用同一份工具表，因此抽到本文件，避免
 * `role-tools.tsx ⇄ role-tools-rich.tsx` 的循环依赖。
 * 内容与原文件逐字一致，未做任何增删。
 */

export interface ToolDef {
  id: string;
  label: string;
  icon: string;
  desc: string;
  roles: ("leadership" | "product" | "sales")[];
  action?: () => void;
  primary?: boolean;
  // 工具的角色化表现
  leadershipVariant?: { hidden?: boolean; label?: string; icon?: string };
  salesVariant?: { label?: string; icon?: string; desc?: string; hidden?: boolean };
}

export const ALL_TOOLS: ToolDef[] = [
  // 产品研发工具
  { id: "cost", label: "成本计算器", icon: "💰", desc: "核算BOM、加工、包材、物流", roles: ["product"], leadershipVariant: { hidden: true }, salesVariant: { label: "利润分析", icon: "💹", desc: "成本10.2元，竞品299元，利润空间" } },
  { id: "compliance", label: "包装合规检查", icon: "📦", desc: "法规、资质、宣称边界", roles: ["product"], leadershipVariant: { hidden: true }, salesVariant: { label: "合规卖点", icon: "✅", desc: "合规可宣称卖点" } },
  { id: "evidence-gap", label: "证据缺口分析", icon: "🔬", desc: "A/B/C/D分级，缺口清单", roles: ["product"], leadershipVariant: { hidden: true }, salesVariant: { hidden: true } },
  { id: "qa-trail", label: "QA轨迹", icon: "🔍", desc: "独立复核、红队轨迹", roles: ["product"], leadershipVariant: { hidden: true } },
  { id: "dependency", label: "工作项依赖图", icon: "📝", desc: "依赖关系、关键路径", roles: ["product"], leadershipVariant: { hidden: true } },
  { id: "timeline", label: "时间线", icon: "📅", desc: "里程碑、交付计划", roles: ["leadership", "product"], salesVariant: { label: "上市计划", icon: "🚀", desc: "快速上市路径" } },

  // 通用工具
  { id: "opportunity", label: "机会分析", icon: "📊", desc: "市场机会、趋势", roles: ["leadership", "product", "sales"], leadershipVariant: { label: "市场概览", icon: "📈" }, salesVariant: { label: "市场机会", icon: "📈", desc: "23%增长，健康趋势" } },
  { id: "risk", label: "风险应对", icon: "⚠️", desc: "风险清单、应对计划", roles: ["leadership", "product"], leadershipVariant: { label: "风险", icon: "⚠️" }, salesVariant: { hidden: true } },

  // 销售工具
  { id: "sales-ppt", label: "生成销售PPT", icon: "📽️", desc: "一键生成销售演示", roles: ["sales"], primary: true, leadershipVariant: { hidden: true }, salesVariant: { label: "销售PPT", icon: "📽️", desc: "一键生成，含卖点/竞品/报价" } },
  { id: "sales-script", label: "销售话术", icon: "📝", desc: "客户沟通脚本", roles: ["sales"], primary: true, leadershipVariant: { hidden: true } },
  { id: "battlecard", label: "竞品对比卡", icon: "⚔️", desc: "竞品对比、优势高亮", roles: ["sales"], primary: true, leadershipVariant: { hidden: true } },
  { id: "quote", label: "报价单", icon: "💰", desc: "成本、利润、报价", roles: ["sales"], leadershipVariant: { hidden: true } },
  { id: "market-chart", label: "市场增长图", icon: "📊", desc: "市场数据可视化", roles: ["sales"], leadershipVariant: { hidden: true } },
  { id: "case", label: "客户案例", icon: "🎯", desc: "成功案例、话术", roles: ["sales"], leadershipVariant: { hidden: true } },
];
