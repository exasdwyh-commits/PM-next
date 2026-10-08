"use client";

import * as React from "react";
import { useRole } from "./role-context";
import "./role-tools.css"
import "./role-tools-rich.css"
import { RoleToolsRich } from "./role-tools-rich";;

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

const ALL_TOOLS: ToolDef[] = [
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

export function RoleToolsOriginal({ 
  onToolClick,
  compact = false,
  showLabel = true,
}: { 
  onToolClick?: (toolId: string) => void;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const { role, source } = useRole();

  const visibleTools = React.useMemo(() => {
    return ALL_TOOLS.filter(tool => {
      if (!tool.roles.includes(role)) {
        // Check if there's a variant that makes it visible
        if (role === "leadership" && tool.leadershipVariant && !tool.leadershipVariant.hidden) return true;
        if (role === "sales" && tool.salesVariant && !tool.salesVariant.hidden) return true;
        return false;
      }
      // Check if hidden for this role
      if (role === "leadership" && tool.leadershipVariant?.hidden) return false;
      if (role === "sales" && tool.salesVariant?.hidden) return false;
      return true;
    });
  }, [role]);

  const getToolDisplay = (tool: ToolDef) => {
    if (role === "leadership" && tool.leadershipVariant) {
      return {
        label: tool.leadershipVariant.label || tool.label,
        icon: tool.leadershipVariant.icon || tool.icon,
        desc: tool.desc,
        hidden: tool.leadershipVariant.hidden,
      };
    }
    if (role === "sales" && tool.salesVariant) {
      return {
        label: tool.salesVariant.label || tool.label,
        icon: tool.salesVariant.icon || tool.icon,
        desc: tool.salesVariant.desc || tool.desc,
        hidden: tool.salesVariant.hidden,
      };
    }
    return { label: tool.label, icon: tool.icon, desc: tool.desc, hidden: false };
  };

  if (role === "leadership") {
    // 领导层：隐藏工具，只显示极简
    return (
      <div className="role-tools leadership">
        {showLabel && <h4>🛠️ 快捷操作</h4>}
        <div className="tools-grid leadership">
          {visibleTools.slice(0, 3).map(tool => {
            const display = getToolDisplay(tool);
            if (display.hidden) return null;
            return (
              <button key={tool.id} className="tool-btn leadership" onClick={() => onToolClick?.(tool.id)}>
                <span className="icon">{display.icon}</span>
                <span className="label">{display.label}</span>
              </button>
            );
          })}
        </div>
        <small className="tools-hint">💡 领导视角：工具已极简，专注结论和决策</small>
      </div>
    );
  }

  if (role === "product") {
    // 产品研发：全部展开，专业严谨
    return (
      <div className="role-tools product">
        {showLabel && <h4>🛠️ 工具流程 (专业严谨 · Kern可调用)</h4>}
        <div className={`tools-grid product ${compact ? "compact" : ""}`}>
          {visibleTools.map(tool => {
            const display = getToolDisplay(tool);
            if (display.hidden) return null;
            return (
              <button key={tool.id} className={`tool-btn product ${tool.primary ? "primary" : ""}`} onClick={() => onToolClick?.(tool.id)}>
                <span className="icon">{display.icon}</span>
                <div className="tool-info">
                  <strong>{display.label}</strong>
                  <small>{display.desc}</small>
                </div>
              </button>
            );
          })}
        </div>
        <small className="tools-hint">🔬 研发视角：工具全部展开，Kern会根据你的问题自动调用，无需手动</small>
      </div>
    );
  }

  // 销售营销：转为销售工具箱
  return (
    <div className="role-tools sales">
      {showLabel && <h4>💼 销售工具箱 (一键生成 · Kern可调用)</h4>}
      <div className={`tools-grid sales ${compact ? "compact" : ""}`}>
        {visibleTools.map(tool => {
          const display = getToolDisplay(tool);
          if (display.hidden) return null;
          return (
            <button key={tool.id} className={`tool-btn sales ${tool.primary ? "primary" : ""}`} onClick={() => onToolClick?.(tool.id)}>
              <span className="icon">{display.icon}</span>
              <div className="tool-info">
                <strong>{display.label}</strong>
                <small>{display.desc}</small>
              </div>
            </button>
          );
        })}
      </div>
      <div className="sales-script-hint">
        <strong>💬 销售话术已就绪</strong>
        <p>“低糖多酚，健康趋势，成本10.2元竞品299元，82%留存率已验证”</p>
        <small>一键复制，可直接用于客户沟通</small>
      </div>
    </div>
  );
}

// 单独的工具按钮，用于嵌入到其他组件
export function ToolButton({ toolId, role, onClick }: { toolId: string; role?: UserRole; onClick?: () => void }) {
  const { role: currentRole, source } = useRole();
  const effectiveRole = role || currentRole;
  const tool = ALL_TOOLS.find(t => t.id === toolId);
  if (!tool) return null;

  const isVisible = tool.roles.includes(effectiveRole) || 
    (effectiveRole === "leadership" && tool.leadershipVariant && !tool.leadershipVariant.hidden) ||
    (effectiveRole === "sales" && tool.salesVariant && !tool.salesVariant.hidden);

  if (!isVisible) return null;

  let display = { label: tool.label, icon: tool.icon, desc: tool.desc };
  if (effectiveRole === "leadership" && tool.leadershipVariant) {
    display = {
      label: tool.leadershipVariant.label || tool.label,
      icon: tool.leadershipVariant.icon || tool.icon,
      desc: tool.desc,
    };
    if (tool.leadershipVariant.hidden) return null;
  }
  if (effectiveRole === "sales" && tool.salesVariant) {
    display = {
      label: tool.salesVariant.label || tool.label,
      icon: tool.salesVariant.icon || tool.icon,
      desc: tool.salesVariant.desc || tool.desc,
    };
    if (tool.salesVariant.hidden) return null;
  }

  return (
    <button className={`tool-btn ${effectiveRole} ${tool.primary ? "primary" : ""}`} onClick={onClick}>
      <span className="icon">{display.icon}</span>
      <span className="label">{display.label}</span>
    </button>
  );
}


export function RoleTools(props: any) {
  try {
    const { role, source } = require("./role-context").useRole();
    if (source !== "default") {
      return <RoleToolsRich {...props} category={props.category || "health_food"} />;
    }
  } catch {}
  return <RoleToolsOriginal {...props} />;
}
