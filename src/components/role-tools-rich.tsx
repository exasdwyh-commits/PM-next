"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { categoryMeta, categoryContent } from "@/modules/tenant";
import "./role-tools.css";
import "./role-tools-rich.css";

export function RoleToolsRich({ category = "health_food", onToolClick, compact = false, showLabel = true }: any) {
  const { role } = useRole();
  const catInfo = categoryMeta(category);
  // 工具清单与销售话术按品类不同，属租户内容，从 pack 读（src/ 不留副本）。
  const content = categoryContent(category);

  const allTools = [
    { id: "cost", label: "成本计算器", icon: "💰", desc: "核算BOM、加工、包材、物流", roles: ["product"], primary: true },
    { id: "compliance", label: "包装合规检查", icon: "📦", desc: "法规、资质、宣称边界", roles: ["product"] },
    { id: "evidence-gap", label: "证据缺口分析", icon: "🔬", desc: "A/B/C/D分级，缺口清单", roles: ["product"] },
    { id: "sales-ppt", label: "生成销售PPT", icon: "📽️", desc: "一键生成销售演示", roles: ["sales"], primary: true },
    { id: "sales-script", label: "销售话术", icon: "📝", desc: "客户沟通脚本", roles: ["sales"], primary: true },
    { id: "battlecard", label: "竞品对比卡", icon: "⚔️", desc: "竞品对比、优势高亮", roles: ["sales"] },
    { id: "timeline", label: "时间线", icon: "📅", desc: "里程碑、交付计划", roles: ["leadership", "product"] },
    { id: "opportunity", label: "机会分析", icon: "📊", desc: "市场机会、趋势", roles: ["leadership", "product", "sales"] },
  ];

  const visibleTools = allTools.filter(t => t.roles.includes(role) || role === "leadership" && t.id === "opportunity" || role === "sales" && ["cost","compliance","timeline","opportunity"].includes(t.id));

  if (role === "leadership") {
    return (
      <div className="role-tools-rich leadership" style={{ borderColor: catInfo.color }}>
        {showLabel && <h4>🛠️ 快捷操作 · {catInfo.icon} {catInfo.name} · {catInfo.color} · 极简 · Kern统筹</h4>}
        <div className="tools-grid-rich leadership">
          {visibleTools.slice(0, 3).map((tool, idx) => (
            <button key={tool.id} className="tool-btn-rich leadership" style={{ animationDelay: `${idx * 80}ms`, borderColor: catInfo.color }} onClick={() => onToolClick?.(tool.id)}>
              <span className="icon">{tool.icon}</span>
              <span className="label">{tool.label}</span>
            </button>
          ))}
        </div>
        <small className="tools-hint">💡 领导视角 · {catInfo.name}专用 · 工具极简，专注结论</small>
      </div>
    );
  }

  if (role === "product") {
    return (
      <div className="role-tools-rich product">
        {showLabel && <h4>🛠️ 工具流程 · {catInfo.icon} {catInfo.name} · 专业严谨 · Kern可调用 · 富可视化</h4>}
        <div className={`tools-grid-rich product ${compact ? "compact" : ""}`}>
          {visibleTools.map((tool, idx) => (
            <button key={tool.id} className={`tool-btn-rich product ${tool.primary ? "primary" : ""}`} style={{ animationDelay: `${idx * 80}ms`, borderLeft: `3px solid ${catInfo.color}` }} onClick={() => onToolClick?.(tool.id)}>
              <span className="icon">{tool.icon}</span>
              <div className="tool-info"><strong>{tool.label} · {catInfo.name}</strong><small>{tool.desc} · {catInfo.name}专用</small></div>
            </button>
          ))}
        </div>
        <small className="tools-hint">🔬 研发视角 · {catInfo.name}专用工具 · Kern自动调用</small>
      </div>
    );
  }

  return (
    <div className="role-tools-rich sales" style={{ background: `linear-gradient(135deg, white, ${catInfo.color}08)` }}>
      {showLabel && <h4>💼 销售工具箱 · {catInfo.icon} {catInfo.name} · 一键生成 · Kern可调用</h4>}
      <div className={`tools-grid-rich sales ${compact ? "compact" : ""}`}>
        {content.tools.map((tool, idx) => (
          <button key={tool.id} className="tool-btn-rich sales primary" style={{ animationDelay: `${idx * 80}ms`, background: catInfo.color, color: "white" }} onClick={() => onToolClick?.(tool.id)}>
            <span className="icon">{tool.icon}</span>
            <div className="tool-info"><strong>{tool.label}</strong><small>{tool.desc}</small></div>
          </button>
        ))}
        {visibleTools.filter(t => !content.tools.find(ct => ct.id === t.id)).slice(0, 3).map((tool, idx) => (
          <button key={tool.id} className="tool-btn-rich sales" style={{ animationDelay: `${(content.tools.length + idx) * 80}ms`, borderColor: catInfo.color }} onClick={() => onToolClick?.(tool.id)}>
            <span className="icon">{tool.icon}</span>
            <div className="tool-info"><strong>{tool.label}</strong><small>{tool.desc}</small></div>
          </button>
        ))}
      </div>
      <div className="sales-script-hint" style={{ borderColor: catInfo.color }}>
        <strong>💬 {catInfo.name}销售话术已就绪 · {catInfo.icon}</strong>
        <p>“{catInfo.name}经过核实，{content.salesPitch}，成本优势明显，竞品高价，利润空间大。”</p>
        <small>一键复制 · {catInfo.name}专用 · Kern生成</small>
      </div>
    </div>
  );
}
