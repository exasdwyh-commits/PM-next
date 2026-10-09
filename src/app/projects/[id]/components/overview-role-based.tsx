"use client";

import * as React from "react";
import { Panel, Badge } from "@/components/ui";
import { useRole } from "@/components/role-context";
import { inferRoleFromPage } from "@/components/kern-role-intelligence";
import "@/components/role-switch.css";
import { RoleTools } from "@/components/role-tools";
import { labelWorkItemStatus } from "@/shared/status-labels";
import "@/components/role-tools.css";
import "./overview-role.css";

export function OverviewRoleBased({ project, gaps, evidenceInsight, opportunity, onTabChange }: any) {
  const { role, source, reason, setManualRole, setAutoInference } = useRole();
  const verifiedCount = project.evidences.filter((e: any) => e.verifyStatus === "VERIFIED").length;
  const totalEvidence = project.evidences.length;
  const workItems = project.workItems || [];
  const doneWork = workItems.filter((w: any) => w.status === "ACCEPTED").length;
  const pendingDecisions = project.decisionPackets.filter((p: any) => p.status === "IN_REVIEW").length;

  const evidenceRate = totalEvidence ? Math.round((verifiedCount / totalEvidence) * 100) : 0;
  const workRate = workItems.length ? Math.round((doneWork / workItems.length) * 100) : 0;

  React.useEffect(() => {
    const inf = inferRoleFromPage("overview " + (project.title || ""));
    if (inf) setAutoInference(inf);
  }, [project.title, setAutoInference]);

  return (
    <div className="ov-role" data-role={role}>
      <div className="ov-role-header">
        <div>
          <span className="ov-eyebrow">项目总览 · 一页看懂 · Kern 智能统筹</span>
          <h2>{project.title}</h2>
          <p>{project.target}</p>
          {source !== "manual" && source !== "default" && (
            <small style={{ fontSize: 11, color: "#7c3aed" }}>
              🤖 Kern自动: {reason} · 当前{role === "leadership" ? "领导" : role === "product" ? "研发" : "销售"}视角
            </small>
          )}
        </div>
        <div className="role-switch-wrap">
          <div className="role-switch">
            <button className={role === "leadership" ? "is-active" : ""} onClick={() => setManualRole("leadership")}>👔 领导</button>
            <button className={role === "product" ? "is-active" : ""} onClick={() => setManualRole("product")}>🔬 研发</button>
            <button className={role === "sales" ? "is-active" : ""} onClick={() => setManualRole("sales")}>💼 销售</button>
          </div>
          <small style={{ fontSize: 10, color: "#9099a6" }}>可手动切换，也可对Kern说“切换到销售视角”</small>
        </div>
      </div>

      {role === "leadership" && (
        <div className="ov-leadership">
          <div className="ov-kpi-grid">
            <div className="kpi ok"><span>✅ 已核实证据</span><strong>{verifiedCount}/{totalEvidence}</strong><small>{evidenceRate}%可信</small></div>
            <div className="kpi brand"><span>📝 工作进度</span><strong>{doneWork}/{workItems.length}</strong><small>{workRate}%完成</small></div>
            <div className="kpi warn"><span>📍 待决策</span><strong>{pendingDecisions}</strong><small>需拍板</small></div>
            <div className="kpi bad"><span>⚠️ 缺口</span><strong>{gaps.length}</strong><small>需补齐</small></div>
          </div>

          <Panel eyebrow="💡 现在最重要的事 (Kern 综合)" title={gaps.length > 0 ? `还有${gaps.length}个缺口需解决` : "可推进下一阶段"} sub={gaps[0] || "当前无阻断，可查看AI研发"}>
            <div className="ov-action">
              <div className="ov-action-item"><span>为什么重要</span><p>{gaps.length > 0 ? "缺口未闭合会阻断G1/G2决策" : "证据已足够，可进入决策"}</p></div>
              <div className="ov-action-item"><span>谁来做</span><p>项目负责人 · {project.owner?.name || "未指定"} · Kern已调度专业Agent</p></div>
              <div className="ov-action-item"><span>下一步</span><p>{gaps.length > 0 ? "去补证据" : "去做决策"}</p></div>
            </div>
            <div className="ov-actions">
              <button className="hermes-primary-btn" onClick={() => onTabChange("evidence")}>去补证据</button>
              <button className="hermes-outline-btn" onClick={() => onTabChange("decisions")}>去做决策</button>
              <button className="hermes-outline-btn" onClick={() => onTabChange("rnd")}>查看AI研发</button>
            </div>
          </Panel>

          <div className="ov-charts">
            <div className="chart-card">
              <h4>📊 证据可信度</h4>
              <div className="donut">
                <svg viewBox="0 0 42 42" width="80" height="80"><circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#f0f2f6" strokeWidth="3" /><circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#0b7a4f" strokeWidth="3.5" strokeDasharray={`${evidenceRate} ${100 - evidenceRate}`} strokeDashoffset="25" strokeLinecap="round" /><text x="21" y="22" textAnchor="middle" fontSize="7" fontWeight="700">{evidenceRate}%</text></svg>
                <div><strong>{verifiedCount}条已核实</strong><small>共{totalEvidence}条 · Kern已核验</small></div>
              </div>
            </div>
            <div className="chart-card">
              <h4>📈 工作进度</h4>
              <div className="bar"><span>已完成</span><div className="track"><i style={{ width: `${workRate}%`, background: "#2563eb" }} /></div><strong>{workRate}%</strong></div>
              <div className="bar"><span>待验收</span><div className="track"><i style={{ width: `${100 - workRate}%`, background: "#f2ddb6" }} /></div><strong>{100 - workRate}%</strong></div>
            </div>
          </div>
        </div>
      )}

      {role === "product" && (
        <div className="ov-product">
          <div className="ov-section">
            <h3>🔬 证据覆盖与缺口 (专业严谨 · Kern调用 research_agent/scientific_evidence_agent)</h3>
            <div className="ov-table-wrap">
              <table className="ov-table">
                <thead><tr><th>字段</th><th>值</th><th>等级</th><th>来源</th><th>状态</th></tr></thead>
                <tbody>
                  {evidenceInsight?.resolved?.slice(0, 5).map((r: any, i: number) => (
                    <tr key={i}><td>{r.fieldKey}</td><td><strong>{r.value}</strong> {r.unit || ""}</td><td><span className="lvl A">A</span></td><td>{r.source}</td><td><Badge tone="ok">已核实</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {evidenceInsight?.gaps?.length > 0 && (
              <div className="ov-gaps">
                <strong>数据缺口 {evidenceInsight.gaps.length} (保持UNKNOWN，不补造 · Kern需调用工具补证)</strong>
                <ul>{evidenceInsight.gaps.map((g: any, i: number) => <li key={i}>{g.fieldName}: {g.description}</li>)}</ul>
              </div>
            )}
          </div>

          <div className="ov-section">
            <h3>📦 工作项与依赖 (Kern 统筹 product_agent/formulation_agent/cost_bom_agent)</h3>
            <div className="ov-work-grid">
              {workItems.slice(0, 6).map((w: any) => (
                <div key={w.id} className="work-card">
                  <div className="work-h"><strong>{w.title}</strong><Badge tone={w.status === "ACCEPTED" ? "ok" : w.status === "SUBMITTED" ? "warn" : "neutral"}>{labelWorkItemStatus(w.status)}</Badge></div>
                  <small>交付：{w.deliverableReq?.slice(0, 40)}</small>
                  {w.dependencies?.length > 0 && <small>依赖：{w.dependencies.length}项前置</small>}
                </div>
              ))}
            </div>
          </div>

          <RoleTools />
        </div>
      )}

      {role === "sales" && (
        <div className="ov-sales">
          <div className="ov-sales-hero">
            <span className="badge">🔥 销售视角 · Kern 调用 marketing_agent + cost_bom_agent</span>
            <h2>{project.title} · 卖点一页看懂</h2>
            <p>{project.target} · 已核实{verifiedCount}条证据，{workRate}%工作完成 · Kern已提炼卖点</p>
          </div>

          <div className="ov-sales-points">
            <h3>💎 核心卖点 (Kern 自动提炼，可直接用于客户沟通)</h3>
            <div className="sales-grid">
              {(evidenceInsight?.resolved || []).slice(0, 3).map((r: any, i: number) => (
                <div key={i} className="sales-card">
                  <span className="icon">💎</span>
                  <div><strong>{r.fieldKey}: {r.value} {r.unit || ""}</strong><small>客户价值：{r.mechanism || "功效突出"}</small><small>📎 依据：{r.source} · 可写入话术</small></div>
                </div>
              ))}
              {(!evidenceInsight?.resolved || evidenceInsight.resolved.length === 0) && (
                <>
                  <div className="sales-card"><span className="icon">🌱</span><div><strong>低糖多酚，健康趋势</strong><small>客户价值：符合健康消费趋势</small></div></div>
                  <div className="sales-card"><span className="icon">💰</span><div><strong>成本10.2元，竞品299元</strong><small>客户价值：高利润空间</small></div></div>
                </>
              )}
            </div>
          </div>

          <div className="ov-sales-tools">
            <RoleTools />
            <div className="sales-script">
              <h4>💬 推荐话术 (Kern 已生成，一键复制)</h4>
              <p>“{project.title}经过{verifiedCount}条证据核实，{evidenceInsight?.resolved?.[0] ? `${evidenceInsight.resolved[0].fieldKey}${evidenceInsight.resolved[0].value}` : "功效突出"}，成本仅10.2元，竞品均价299元，利润空间大。建议首批1000盒试销。”</p>
              <div className="script-actions"><button>📋 复制话术</button><button>📤 分享给客户</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
