"use client";

/**
 * 角色化工具区（rich 版，本地补齐）
 * --------------------------------
 * Arena 工作区未交付本文件，而 role-tools.tsx 的 `RoleTools` 在有明确角色时
 * 会渲染 `<RoleToolsRich />`。本实现按 MASTER_PLAN_4CAT.md 的角色规范还原：
 *   领导 = 极简（只留少数决策类工具）
 *   产品 = 全量工具 + 分组
 *   销售 = 卖点/话术/工具箱，主推 primary 工具
 * 工具数据复用 ./role-tools-data，与 RoleToolsOriginal 同源，不做第二份定义。
 */

import * as React from "react";
import { ALL_TOOLS, type ToolDef } from "./role-tools-data";
import { useRole, ROLE_LABELS } from "./role-context";
import "./role-tools-rich.css";

export interface RoleToolsRichProps {
  category?: string;
  onToolClick?: (toolId: string) => void;
  compact?: boolean;
  showLabel?: boolean;
  /** 兜底：调用方可能透传其它属性 */
  [key: string]: unknown;
}

/** 领导视角只保留这些工具，避免信息过载。 */
const LEADERSHIP_KEEP = new Set(["opportunity", "risk", "timeline"]);

function variantsFor(tool: ToolDef, role: "leadership" | "product" | "sales") {
  if (role === "leadership" && tool.leadershipVariant) {
    if (tool.leadershipVariant.hidden) return null;
    return {
      label: tool.leadershipVariant.label || tool.label,
      icon: tool.leadershipVariant.icon || tool.icon,
      desc: tool.desc,
    };
  }
  if (role === "sales" && tool.salesVariant) {
    if (tool.salesVariant.hidden) return null;
    return {
      label: tool.salesVariant.label || tool.label,
      icon: tool.salesVariant.icon || tool.icon,
      desc: tool.salesVariant.desc || tool.desc,
    };
  }
  return { label: tool.label, icon: tool.icon, desc: tool.desc };
}

function visibleTools(role: "leadership" | "product" | "sales"): ToolDef[] {
  if (role === "leadership") {
    return ALL_TOOLS.filter((t) => LEADERSHIP_KEEP.has(t.id));
  }
  return ALL_TOOLS.filter((tool) => {
    const variant = variantsFor(tool, role);
    if (!variant) return false;
    if (role === "sales") return tool.roles.includes("sales") || Boolean(tool.salesVariant && !tool.salesVariant.hidden);
    return tool.roles.includes(role);
  });
}

export function RoleToolsRich({ category = "health_food", onToolClick, compact = false, showLabel = true }: RoleToolsRichProps) {
  const { role, source, reason } = useRole();
  const tools = React.useMemo(() => visibleTools(role), [role]);

  const grouped = React.useMemo(() => {
    const primary = tools.filter((t) => t.primary);
    const rest = tools.filter((t) => !t.primary);
    return { primary, rest };
  }, [tools]);

  const renderButton = (tool: ToolDef) => {
    const variant = variantsFor(tool, role);
    if (!variant) return null;
    return (
      <button
        key={tool.id}
        type="button"
        className={`role-tool-rich${tool.primary ? " is-primary" : ""}`}
        onClick={() => onToolClick?.(tool.id)}
        title={variant.desc}
      >
        <span className="role-tool-rich__icon" aria-hidden>
          {variant.icon}
        </span>
        {showLabel && (
          <span className="role-tool-rich__body">
            <span className="role-tool-rich__label">{variant.label}</span>
            {!compact && <span className="role-tool-rich__desc">{variant.desc}</span>}
          </span>
        )}
      </button>
    );
  };

  return (
    <section className={`role-tools-rich role-tools-rich--${role}`} data-role={role} data-category={category}>
      <header className="role-tools-rich__head">
        <h4>🧰 {ROLE_LABELS[role]}工具箱</h4>
        {source !== "default" && reason ? <small>{reason}</small> : null}
      </header>

      {grouped.primary.length > 0 && (
        <div className="role-tools-rich__grid role-tools-rich__grid--primary">
          {grouped.primary.map(renderButton)}
        </div>
      )}

      <div className="role-tools-rich__grid">{grouped.rest.map(renderButton)}</div>

      {tools.length === 0 && <p className="role-tools-rich__empty">当前角色没有可用工具。</p>}
    </section>
  );
}

export default RoleToolsRich;
