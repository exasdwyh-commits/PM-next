"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { loadScenarios, saveScenario, deleteScenario, duplicateScenario, compareScenarios, exportScenarioToCsv, getScenarioStats, loadScenariosApi, saveScenarioApi, deleteScenarioApi, compareScenariosApi, type CostScenario } from "@/modules/cost-engine/scenario";
import { CostComparisonCharts } from "./cost-comparison-charts";
import { CostApproval } from "./cost-approval";
import { CostCollaboration } from "./cost-collaboration";
import { Notice, type NoticeMessage } from "./notice";
import "./cost-approval.css";
import "./cost-collaboration.css";
import "./cost-comparison-charts.css";
import "./cost-scenario-manager.css";

export function CostScenarioManager({
  currentScenario,
  onLoad,
  projectId,
}: {
  currentScenario?: Partial<CostScenario>;
  onLoad?: (scenario: CostScenario) => void;
  projectId?: string;
}) {
  const { role } = useRole();
  const [scenarios, setScenarios] = React.useState<CostScenario[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [showCompare, setShowCompare] = React.useState(false);
  const [scenarioSubTab, setScenarioSubTab] = React.useState<"list" | "approval" | "collab">("list");
  const [selectedScenarioForDetail, setSelectedScenarioForDetail] = React.useState<CostScenario | null>(null);
  const [saveName, setSaveName] = React.useState("");
  const [msg, setMsg] = React.useState<NoticeMessage | null>(null);

  React.useEffect(() => {
    const load = async () => {
      try {
        const data = await loadScenariosApi({ projectId });
        setScenarios(data.scenarios as any);
      } catch {
        setScenarios(loadScenarios());
      }
    };
    load();
  }, [projectId]);

  const handleSave = async () => {
    if (!currentScenario || !saveName) return;
    const scenario: CostScenario = {
      id: currentScenario.id || `scenario-${Date.now()}`,
      name: saveName,
      category: (currentScenario.category as any) || "health_food",
      productName: currentScenario.productName || "未命名产品",
      createdAt: currentScenario.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      moduleValues: currentScenario.moduleValues || {},
      bomItems: currentScenario.bomItems || [],
      supplierQuotes: currentScenario.supplierQuotes || [],
      complianceItems: currentScenario.complianceItems || [],
      totalMaterialCost: currentScenario.totalMaterialCost || 0,
      totalManufacturingCost: currentScenario.totalManufacturingCost || 0,
      totalPackagingCost: currentScenario.totalPackagingCost || 0,
      totalLogisticsCost: currentScenario.totalLogisticsCost || 0,
      totalComplianceCost: currentScenario.totalComplianceCost || 0,
      totalChannelCost: currentScenario.totalChannelCost || 0,
      totalCost: currentScenario.totalCost || 0,
      suggestedRetailPrice: currentScenario.suggestedRetailPrice || 0,
      profitMargin: currentScenario.profitMargin || 0,
      notes: currentScenario.notes,
      tags: currentScenario.tags,
    };
    try {
      const saved = await saveScenarioApi({ ...scenario, projectId } as any);
      setScenarios(prev => [saved as any, ...prev]);
    } catch {
      const all = saveScenario(scenario);
      setScenarios(all);
    }
    setSaveName("");
  };

  const handleDelete = (id: string) => {
    const all = deleteScenario(id);
    setScenarios(all);
  };

  const handleDuplicate = (id: string) => {
    const copy = duplicateScenario(id);
    if (copy) setScenarios(loadScenarios());
  };

  const handleExport = (scenario: CostScenario) => {
    const csv = exportScenarioToCsv(scenario);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const comparison = React.useMemo(() => selectedIds.length >= 2 ? compareScenarios(selectedIds) : null, [selectedIds]);
  const stats = React.useMemo(() => getScenarioStats(), [scenarios]);

  if (role === "leadership") {
    return (
      <div className="scenario-manager leadership">
        <h4>💾 成本方案 · {stats.total}个 · 均价 ¥{stats.avgCost.toFixed(2)}</h4>
        <div className="scenario-kpi">
          <span>总计 {stats.total}</span>
          <span>收藏 {stats.favorites}</span>
          <span>普通 {stats.byCategory["regular_food"] || 0} · 保健 {stats.byCategory["health_food"] || 0} · 跨境 {stats.byCategory["cross_border_food"] || 0} · 化妆 {stats.byCategory["cosmetics"] || 0}</span>
        </div>
        <div className="scenario-cards">
          {scenarios.slice(0, 3).map(s => (
            <div key={s.id} className="s-card"><strong>{s.name}</strong><small>¥{s.totalCost.toFixed(2)} · {s.suggestedRetailPrice.toFixed(0)}元 · {(s.profitMargin*100).toFixed(0)}%</small></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="scenario-manager" data-role={role}>
      <Notice msg={msg} onClose={() => setMsg(null)} />
      <div className="scenario-header">
        <div>
          <h4>💾 成本方案管理 · 模块化</h4>
          <small>共 {stats.total}个方案 · 均价 ¥{stats.avgCost.toFixed(2)} · 收藏 {stats.favorites} · 分类：普通{stats.byCategory["regular_food"]||0} 保健{stats.byCategory["health_food"]||0} 跨境{stats.byCategory["cross_border_food"]||0} 化妆{stats.byCategory["cosmetics"]||0}</small>
        </div>
        <div className="scenario-actions">
          <button disabled={selectedIds.length < 2} onClick={() => setShowCompare(!showCompare)}>{showCompare ? "关闭对比" : `对比 (${selectedIds.length})`}</button>
        </div>
      </div>

      <div className="save-bar">
        <input placeholder="方案名称，例如：多酚软糖V2-跨境版" value={saveName} onChange={e => setSaveName(e.target.value)} />
        <button className="primary" onClick={handleSave} disabled={!saveName}>💾 保存当前方案</button>
      </div>

      {showCompare && comparison && (
        <>
        <CostComparisonCharts scenarios={comparison.scenarios as any} comparison={comparison.comparison as any} />
        <div className="compare-panel">
          <h5>📊 方案对比 · {comparison.scenarios.length}个</h5>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead><tr><th>指标</th>{comparison.scenarios.map(s => <th key={s.id}>{s.name}</th>)}<th>最低</th><th>最高</th><th>均值</th></tr></thead>
              <tbody>
                {Object.entries(comparison.comparison).map(([metric, vals]) => (
                  <tr key={metric}>
                    <td>{metric === "totalCost" ? "总成本" : metric === "totalMaterialCost" ? "原料" : metric === "suggestedRetailPrice" ? "零售价" : metric === "profitMargin" ? "利润率" : metric}</td>
                    {comparison.scenarios.map(s => <td key={s.id}>{typeof (s as any)[metric] === "number" ? ((s as any)[metric] as number).toFixed(2) : "-"}</td>)}
                    <td className="min">¥{vals.min.toFixed(2)}</td>
                    <td className="max">¥{vals.max.toFixed(2)}</td>
                    <td>¥{vals.avg.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {scenarioSubTab === "list" && (
      <div className="scenario-grid">
        {scenarios.map(s => (
          <div key={s.id} className={`scenario-card ${selectedIds.includes(s.id) ? "selected" : ""} ${s.category}`}>
            <div className="s-h">
              <label><input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggleSelect(s.id)} /><strong>{s.name}</strong></label>
              <span className={`cat ${s.category}`}>{s.category === "regular_food" ? "🍪普通" : s.category === "health_food" ? "💊保健" : s.category === "cross_border_food" ? "🌍跨境" : "💄化妆"}</span>
            </div>
            <div className="s-meta"><span>{s.productName}</span><span>{new Date(s.updatedAt).toLocaleDateString()}</span></div>
            <div className="s-kpi"><span>成本 ¥{s.totalCost.toFixed(2)}</span><span>零售 ¥{s.suggestedRetailPrice.toFixed(0)}</span><span>利润 {(s.profitMargin*100).toFixed(0)}%</span></div>
            <div className="s-breakdown"><small>原料{ s.totalMaterialCost.toFixed(1)} + 生产{ s.totalManufacturingCost.toFixed(1)} + 包装{ s.totalPackagingCost.toFixed(1)} + 物流{ s.totalLogisticsCost.toFixed(1)} + 合规{ s.totalComplianceCost.toFixed(1)} + 渠道{ s.totalChannelCost.toFixed(1)}</small></div>
            <div className="s-actions">
              <button onClick={() => { setSelectedScenarioForDetail(s); onLoad?.(s); }}>📂 加载</button>
              <button onClick={() => handleDuplicate(s.id)}>📋 复制</button>
              <button onClick={() => handleExport(s)}>📤 导出</button>
              <button className="danger" onClick={() => handleDelete(s.id)}>🗑️ 删除</button>
            </div>
          </div>
        ))}
        {scenarios.length === 0 && <div className="empty">暂无保存方案，输入名称后保存当前成本</div>}
      </div>
      )}

      {scenarioSubTab === "approval" && (
        <div style={{ display: "grid", gap: 12 }}>
          {selectedScenarioForDetail ? (
            <CostApproval scenario={selectedScenarioForDetail} approvals={[]} onSubmit={() => setMsg({ tone: "ok", text: "已提交审批，产品审核→领导审批" })} onApprove={() => setMsg({ tone: "ok", text: "已批准" })} onReject={() => setMsg({ tone: "ok", text: "已驳回" })} />
          ) : (
            <div style={{ padding: 20, textAlign: "center", color: "#6b7280", fontSize: 12, border: "1px dashed #e7e9ef", borderRadius: 8 }}>
              请先在列表中选择一个方案，点击&quot;📂 加载&quot;旁的选择，选择后在此查看审批流
              <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center" }}>
                {scenarios.slice(0, 3).map(s => (
                  <button key={s.id} onClick={() => setSelectedScenarioForDetail(s)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e7e9ef", background: "white", fontSize: 10, cursor: "pointer" }}>{s.name}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {scenarioSubTab === "collab" && (
        <div style={{ display: "grid", gap: 12 }}>
          {selectedScenarioForDetail ? (
            <CostCollaboration scenario={selectedScenarioForDetail} comments={[]} onAddComment={(content: string) => setMsg({ tone: "ok", text: `评论：${content}` })} />
          ) : (
            <div style={{ padding: 20, textAlign: "center", color: "#6b7280", fontSize: 12, border: "1px dashed #e7e9ef", borderRadius: 8 }}>
              请先在列表中选择一个方案
              <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center" }}>
                {scenarios.slice(0, 3).map(s => (
                  <button key={s.id} onClick={() => setSelectedScenarioForDetail(s)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e7e9ef", background: "white", fontSize: 10, cursor: "pointer" }}>{s.name}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {role === "sales" && scenarios.length > 0 && (
        <div className="scenario-sales">
          <strong>💼 销售视角：方案优势</strong>
          <p>已保存 {stats.total} 个成本方案，平均成本 ¥{stats.avgCost.toFixed(2)}，可快速切换对比，为客户提供不同价位选择。</p>
        </div>
      )}
    </div>
  );
}
