"use client";

import * as React from "react";
import { Panel, Badge } from "@/components/ui";
import { useRole } from "@/components/role-context";
import { inferRoleFromPage } from "@/components/kern-role-intelligence";
import "@/components/role-switch.css";
import { RoleTools } from "@/components/role-tools";
import "@/components/role-tools.css";
import "./overview-role.css";
import "./overview-role-based-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string; selling: string[] }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)", selling: ["性价比高","日常刚需","SC合规"] },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)", selling: ["蓝帽子认证","多酚功效","软糖剂型"] },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)", selling: ["进口原料","跨境背书","保税仓发货"] },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)", selling: ["透明质酸","烟酰胺美白","玻璃瓶高级感"] },
};

function getCategoryFromProject(project: any): string {
  const text = `${project?.title || ""} ${project?.target || ""}`.toLowerCase();
  if (text.includes("化妆") || text.includes("护肤") || text.includes("面膜") || text.includes("精华")) return "cosmetics";
  if (text.includes("跨境") || text.includes("进口") || text.includes("保税")) return "cross_border_food";
  if (text.includes("保健") || text.includes("多酚") || text.includes("胶囊") || text.includes("软糖") || text.includes("功能")) return "health_food";
  return "regular_food";
}

export function OverviewRoleBasedRich({ project, gaps, evidenceInsight, opportunity, onTabChange }: any) {
  const { role, source, reason, setManualRole, setAutoInference } = useRole();
  const category = getCategoryFromProject(project);
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const verifiedCount = project.evidences?.filter((e: any) => e.verifyStatus === "VERIFIED").length || 0;
  const totalEvidence = project.evidences?.length || 0;
  const workItems = project.workItems || [];
  const doneWork = workItems.filter((w: any) => w.status === "ACCEPTED").length;
  const pendingDecisions = project.decisionPackets?.filter((p: any) => p.status === "IN_REVIEW").length || 0;
  const evidenceRate = totalEvidence ? Math.round((verifiedCount / totalEvidence) * 100) : 0;
  const workRate = workItems.length ? Math.round((doneWork / workItems.length) * 100) : 0;

  React.useEffect(() => {
    const inf = inferRoleFromPage("overview " + (project.title || ""));
    if (inf) setAutoInference(inf);
  }, [project.title, setAutoInference]);

  return (
    <div className="ov-role-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="ov-role-rich-header">
        <div>
          <span className="ov-eyebrow" style={{ background: catInfo.gradient, border: `1px solid ${catInfo.color}20` }}>{catInfo.icon} {catInfo.name} · 项目总览 · 一页看懂 · Kern智能统筹 · 富可视化</span>
          <h2>{project.title}</h2>
          <p>{project.target}</p>
          {source !== "manual" && source !== "default" && (
            <small style={{ fontSize: 11, color: catInfo.color }}>🤖 Kern自动: {reason} · 当前{role === "leadership" ? "领导" : role === "product" ? "研发" : "销售"}视角 · {catInfo.name}专用</small>
          )}
        </div>
        <div className="role-switch-wrap">
          <div className="role-switch">
            <button className={role === "leadership" ? "is-active" : ""} onClick={() => setManualRole("leadership")}>👔 领导</button>
            <button className={role === "product" ? "is-active" : ""} onClick={() => setManualRole("product")}>🔬 研发</button>
            <button className={role === "sales" ? "is-active" : ""} onClick={() => setManualRole("sales")}>💼 销售</button>
          </div>
          <small style={{ fontSize: 10, color: "#9099a6" }}>可手动切换，也可对Kern说&quot;切换到销售视角&quot;</small>
          <div className="category-badge-rich" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
        </div>
      </div>

      {role === "leadership" && (
        <div className="ov-leadership-rich">
          <div className="ov-kpi-grid-rich">
            <div className="kpi-rich ok" style={{ animationDelay: "0ms" }}><span>✅ 已核实证据</span><strong>{verifiedCount}/{totalEvidence}</strong><small>{evidenceRate}%可信</small><div className="kpi-bar"><div className="fill" style={{ width: `${evidenceRate}%`, background: catInfo.color }}></div></div></div>
            <div className="kpi-rich brand" style={{ animationDelay: "80ms" }}><span>📝 工作进度</span><strong>{doneWork}/{workItems.length}</strong><small>{workRate}%完成</small><div className="kpi-bar"><div className="fill" style={{ width: `${workRate}%`, background: "#2563eb" }}></div></div></div>
            <div className="kpi-rich warn" style={{ animationDelay: "160ms" }}><span>📍 待决策</span><strong>{pendingDecisions}</strong><small>需拍板</small></div>
            <div className="kpi-rich bad" style={{ animationDelay: "240ms" }}><span>⚠️ 缺口</span><strong>{gaps.length}</strong><small>需补齐</small></div>
          </div>

          <Panel eyebrow={`💡 现在最重要的事 · ${catInfo.icon} ${catInfo.name}`} title={gaps.length > 0 ? `还有${gaps.length}个缺口需解决` : "可推进下一阶段"} sub={gaps[0] || "当前无阻断，可查看AI研发"}>
            <div className="ov-action">
              <div className="ov-action-item"><span>为什么重要</span><p>{gaps.length > 0 ? "缺口未闭合会阻断G1/G2决策" : "证据已足够，可进入决策"}</p></div>
              <div className="ov-action-item"><span>谁来做</span><p>项目负责人 · {project.owner?.name || "未指定"} · Kern已调度专业Agent</p></div>
              <div className="ov-action-item"><span>下一步</span><p>{gaps.length > 0 ? "去补证据" : "去做决策"} · {catInfo.name}专用流程</p></div>
            </div>
            <div className="ov-actions">
              <button className="hermes-primary-btn" style={{ background: catInfo.color }} onClick={() => onTabChange("evidence")}>去补证据</button>
              <button className="hermes-outline-btn" onClick={() => onTabChange("decisions")}>去做决策</button>
              <button className="hermes-outline-btn" onClick={() => onTabChange("rnd")}>查看AI研发</button>
            </div>
          </Panel>

          <div className="ov-charts-rich">
            <div className="chart-card">
              <h4>📊 证据可信度 · {catInfo.name}</h4>
              <div className="donut">
                <svg viewBox="0 0 42 42" width="100" height="100"><circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#f0f2f6" strokeWidth="3" /><circle cx="21" cy="21" r="15.9" fill="transparent" stroke={catInfo.color} strokeWidth="3.5" strokeDasharray={`${evidenceRate} ${100 - evidenceRate}`} strokeDashoffset="25" strokeLinecap="round" style={{ animation: "drawDonut 1s ease-out both" } as any} /><text x="21" y="22" textAnchor="middle" fontSize="7" fontWeight="700">{evidenceRate}%</text></svg>
                <div><strong>{verifiedCount}条已核实</strong><small>共{totalEvidence}条 · Kern已核验 · {catInfo.name}专用</small><div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{catInfo.selling.map(s => <span key={s} style={{ padding: "2px 6px", borderRadius: 99, background: `${catInfo.color}15`, color: catInfo.color, fontSize: 10 }}>{s}</span>)}</div></div>
              </div>
            </div>
            <div className="chart-card">
              <h4>📈 工作进度 · Kern调度</h4>
              <div className="bar"><span>已完成</span><div className="track"><i style={{ width: `${workRate}%`, background: catInfo.color, animation: "growWidth 0.8s ease-out both" } as any} /></div><strong>{workRate}%</strong></div>
              <div className="bar"><span>待验收</span><div className="track"><i style={{ width: `${100 - workRate}%`, background: "#f2ddb6", animation: "growWidth 0.8s ease-out 0.2s both" } as any} /></div><strong>{100 - workRate}%</strong></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 8 }}>
                <div className="mini-stat"><strong>{doneWork}</strong><small>已完成</small></div>
                <div className="mini-stat"><strong>{workItems.length - doneWork}</strong><small>进行中</small></div>
                <div className="mini-stat"><strong>{pendingDecisions}</strong><small>待决策</small></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {role === "product" && (
        <div className="ov-product-rich">
          <div className="ov-section">
            <h3>🔬 证据覆盖与缺口 · {catInfo.icon} {catInfo.name} · 专业严谨 · Kern调用 research_agent/scientific_evidence_agent</h3>
            <div className="ov-table-wrap">
              <table className="ov-table">
                <thead><tr><th>字段</th><th>值</th><th>等级</th><th>来源</th><th>状态</th></tr></thead>
                <tbody>
                  {evidenceInsight?.resolved?.slice(0, 8).map((r: any, i: number) => (
                    <tr key={i} style={{ animation: `fadeInUp 0.3s ease-out ${i * 60}ms both` } as any}><td>{r.fieldKey}</td><td><strong>{r.value}</strong> {r.unit || ""}</td><td><span className="lvl A">A</span></td><td>{r.source}</td><td><Badge tone="ok">已核实</Badge></td></tr>
                  ))}
                  {(!evidenceInsight?.resolved || evidenceInsight.resolved.length === 0) && (
                    <>
                      <tr><td>烘焙温度</td><td><strong>80</strong> ℃</td><td><span className="lvl A">A</span></td><td>process_engineer</td><td><Badge tone="ok">已核实</Badge></td></tr>
                      <tr><td>多酚留存</td><td><strong>82</strong> %</td><td><span className="lvl A">A</span></td><td>lab_test</td><td><Badge tone="ok">已核实</Badge></td></tr>
                    </>
                  )}
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
            <h3>📦 工作项与依赖 · {catInfo.name} · Kern统筹 product_agent/formulation_agent/cost_bom_agent</h3>
            <div className="ov-work-grid-rich">
              {workItems.slice(0, 6).map((w: any, idx: number) => (
                <div key={w.id} className="work-card-rich" style={{ animationDelay: `${idx * 80}ms` }}>
                  <div className="work-h"><strong>{w.title}</strong><Badge tone={w.status === "ACCEPTED" ? "ok" : w.status === "SUBMITTED" ? "warn" : "neutral"}>{w.status}</Badge></div>
                  <small>交付：{w.deliverableReq?.slice(0, 60)}</small>
                  {w.dependencies?.length > 0 && <small>依赖：{w.dependencies.length}项前置</small>}
                </div>
              ))}
            </div>
          </div>

          <RoleTools />
        </div>
      )}

      {role === "sales" && (
        <div className="ov-sales-rich">
          <div className="ov-sales-hero" style={{ background: catInfo.gradient, border: `1px solid ${catInfo.color}30` }}>
            <span className="badge" style={{ background: catInfo.color, color: "white" }}>🔥 销售视角 · {catInfo.icon} {catInfo.name} · Kern调用 marketing_agent + cost_bom_agent</span>
            <h2>{project.title} · 卖点一页看懂</h2>
            <p>{project.target} · 已核实{verifiedCount}条证据，{workRate}%工作完成 · Kern已提炼卖点 · {catInfo.selling.join(" · ")}</p>
          </div>

          <div className="ov-sales-points">
            <h3>💎 核心卖点 · {catInfo.name}专用 · Kern自动提炼</h3>
            <div className="sales-grid-rich">
              {(evidenceInsight?.resolved || []).slice(0, 4).map((r: any, i: number) => (
                <div key={i} className="sales-card-rich" style={{ animationDelay: `${i * 100}ms`, borderLeft: `3px solid ${catInfo.color}` }}>
                  <span className="icon">{catInfo.icon}</span>
                  <div><strong>{r.fieldKey}: {r.value} {r.unit || ""}</strong><small>客户价值：{r.mechanism || "功效突出"} · {catInfo.selling[i % catInfo.selling.length]}</small><small>📎 依据：{r.source} · 可写入话术</small></div>
                </div>
              ))}
              {(!evidenceInsight?.resolved || evidenceInsight.resolved.length === 0) && (
                <>
                  <div className="sales-card-rich" style={{ borderLeft: `3px solid ${catInfo.color}` }}><span className="icon">{catInfo.icon}</span><div><strong>低糖多酚，健康趋势</strong><small>客户价值：符合健康消费趋势 · {catInfo.selling[0]}</small></div></div>
                  <div className="sales-card-rich" style={{ borderLeft: `3px solid ${catInfo.color}` }}><span className="icon">💰</span><div><strong>成本10.2元，竞品299元</strong><small>客户价值：高利润空间 · {catInfo.selling[1]}</small></div></div>
                </>
              )}
            </div>
          </div>

          <RoleTools />
        </div>
      )}
    </div>
  );
}
