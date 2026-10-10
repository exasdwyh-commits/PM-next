"use client";

import { useRole } from "@/components/role-context";

const VIEWS = [
  { role: "leadership", label: "领导", hint: "先看结论与需要你决定的事" },
  { role: "product", label: "研发", hint: "先看依据、缺口与验证计划" },
  { role: "sales", label: "销售", hint: "先看客户价值与销售支撑" },
] as const;

export function KernRoleBar() {
  const { role, source, reason, confidence, setManualRole } = useRole();
  const sourceLabel = source === "manual" ? "手动" : source === "kern" ? "Kern 建议" : source === "auto" ? "自动" : source === "memory" ? "记忆偏好" : "默认";
  const sourceHint = `${sourceLabel}${reason ? `：${reason}` : ""}${confidence > 0 && source !== "manual" && source !== "default" ? `（${Math.round(confidence * 100)}%）` : ""}`;

  return (
    <div className="m-role-bar">
      <span className="m-role-label">回复视角</span>
      <div className="m-role-options" role="group" aria-label="回复视角">
        {VIEWS.map((view) => (
          <button key={view.role} type="button" aria-pressed={role === view.role} onClick={() => setManualRole(view.role)} title={view.hint}>{view.label}</button>
        ))}
      </div>
      <span className="m-role-source" title={sourceHint}>{sourceLabel}</span>
      <span className="m-role-hint">只调整呈现，不改变操作权限</span>
    </div>
  );
}
