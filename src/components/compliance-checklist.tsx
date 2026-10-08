"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { getComplianceChecklist, calculateComplianceCost, getComplianceForRole, type ComplianceItem } from "@/modules/cost-engine/compliance-checklist";
import "./compliance-checklist.css";

export function ComplianceChecklist({
  category = "health_food",
}: {
  category?: string;
}) {
  const { role } = useRole();
  const [items, setItems] = React.useState<ComplianceItem[]>(() => getComplianceChecklist(category));
  const [filter, setFilter] = React.useState<"all" | "required" | "pending">("all");

  React.useEffect(() => {
    setItems(getComplianceChecklist(category));
  }, [category]);

  const cost = React.useMemo(() => calculateComplianceCost(category), [category]);
  const roleItems = React.useMemo(() => getComplianceForRole(category, role), [category, role]);

  const toggleStatus = (id: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, status: item.status === "done" ? "pending" : "done" } : item));
  };

  const filtered = items.filter(item => {
    if (filter === "required") return item.required;
    if (filter === "pending") return item.status !== "done";
    return true;
  });

  const doneCount = items.filter(i => i.status === "done").length;
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  if (role === "leadership") {
    return (
      <div className="compliance-checklist leadership">
        <h4>📋 合规进度 · {doneCount}/{items.length} · {progress}%</h4>
        <div className="progress-bar"><div className="fill" style={{ width: `${progress}%` }} /></div>
        <div className="compliance-kpi">
          <span>必需 {cost.requiredCount}项</span>
          <span>费用 ¥{cost.totalCost.toLocaleString()}</span>
          <span>周期 {cost.totalDays}天</span>
        </div>
        <div className="compliance-cards">
          {roleItems.slice(0, 3).map(item => (
            <div key={item.id} className={`comp-card ${item.status}`}><strong>{item.label}</strong><small>{item.required ? "必需" : "可选"}</small></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="compliance-checklist" data-role={role}>
      <div className="compliance-header">
        <div>
          <h4>📋 合规清单 · {category === "regular_food" ? "普通食品" : category === "health_food" ? "保健食品" : category === "cross_border_food" ? "跨境食品" : "化妆品"}</h4>
          <small>进度 {doneCount}/{items.length} ({progress}%) · 必需 {cost.requiredCount}项 · 费用 ¥{cost.totalCost.toLocaleString()} · 周期 {cost.totalDays}天</small>
        </div>
        <div className="compliance-actions">
          <select value={category} onChange={e => setItems(getComplianceChecklist(e.target.value))}>
            <option value="regular_food">🍪 普通食品</option>
            <option value="health_food">💊 保健食品</option>
            <option value="cross_border_food">🌍 跨境食品</option>
            <option value="cosmetics">💄 化妆品</option>
          </select>
          <select value={filter} onChange={e => setFilter(e.target.value as any)}>
            <option value="all">全部</option>
            <option value="required">必需</option>
            <option value="pending">待办</option>
          </select>
        </div>
      </div>

      <div className="progress-bar"><div className="fill" style={{ width: `${progress}%` }} /><span>{progress}%</span></div>

      <div className="compliance-grid">
        {filtered.map(item => (
          <div key={item.id} className={`compliance-item ${item.status || "pending"} ${item.required ? "required" : "optional"}`}>
            <div className="item-h">
              <label><input type="checkbox" checked={item.status === "done"} onChange={() => toggleStatus(item.id)} /><strong>{item.label}</strong></label>
              <span className={`badge ${item.required ? "required" : "optional"}`}>{item.required ? "必需" : "可选"}</span>
            </div>
            <p>{item.description}</p>
            <div className="item-meta">
              <span>费用：¥{(item.estimatedCost || 0).toLocaleString()}</span>
              <span>周期：{item.estimatedDays || 0}天</span>
              <span>类别：{item.category}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="compliance-summary">
        <div className="summary-row"><span>必需项</span><strong>{cost.requiredCount}项</strong><span>¥{cost.totalCost.toLocaleString()}</span></div>
        <div className="summary-row"><span>可选项</span><strong>{cost.optionalCount}项</strong></div>
        <div className="summary-row total"><span>总计</span><strong>{items.length}项</strong><span>最长 {cost.totalDays}天</span></div>
      </div>

      {role === "sales" && (
        <div className="compliance-sales">
          <strong>💼 销售视角：合规卖点</strong>
          <p>已完成 {doneCount}/{items.length} 项合规，{cost.requiredCount}项必需已{items.filter(i => i.required && i.status === "done").length === cost.requiredCount ? "全部完成" : "部分完成"}，{category === "health_food" ? "蓝帽子" : category === "cosmetics" ? "备案" : "SC/进口备案"}合规可作为卖点。</p>
        </div>
      )}
    </div>
  );
}
