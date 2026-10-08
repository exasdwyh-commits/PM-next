"use client";

import * as React from "react";
import { useRole } from "./role-context";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import "./executive-report-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg, #fffbeb, #fef3c7)" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg, #f3f0ff, #e9d5ff)" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg, #ecfeff, #a5f3fc)" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg, #fdf2f8, #fbcfe8)" },
};

function getCategoryFromReport(report: ExecutiveReportPayload): string {
  const text = (report.summary || "" + report.title || "").toLowerCase();
  if (text.includes("多酚") || text.includes("保健") || text.includes("胶囊") || text.includes("软糖")) return "health_food";
  if (text.includes("跨境") || text.includes("进口") || text.includes("关税")) return "cross_border_food";
  if (text.includes("化妆") || text.includes("护肤") || text.includes("精华") || text.includes("玻尿酸")) return "cosmetics";
  return "regular_food";
}

export function ExecutiveReportRich({ report }: { report: ExecutiveReportPayload }) {
  const { role } = useRole();
  const category = getCategoryFromReport(report);
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.regular_food;

  const conclusions = report.conclusions || [];
  const risks = report.risks || [];
  const decisions = report.decisionsRequired || [];
  const evidenceCount = conclusions.length;
  const verifiedCount = conclusions.filter((c: any) => c.evidenceLevel === "A" || c.evidenceLevel === "B").length;
  const verifiedRate = evidenceCount ? Math.round((verifiedCount / evidenceCount) * 100) : 0;

  const levels = { A: 0, B: 0, C: 0, D: 0 };
  conclusions.forEach((c: any) => {
    const lvl = (c.evidenceLevel || "D").toUpperCase();
    if ((levels as any)[lvl] !== undefined) (levels as any)[lvl]++;
  });

  if (role === "leadership") {
    return (
      <div className="executive-report-rich leadership" style={{ background: catInfo.gradient }}>
        <div className="report-header">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: catInfo.color, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 20 }}>{catInfo.icon}</div>
            <div>
              <h3>{report.title || `${catInfo.name}执行报告`}</h3>
              <small>{catInfo.name} · {evidenceCount}条结论 · {verifiedRate}%可信 · 领导层视角</small>
            </div>
          </div>
          <div className="status-badge" style={{ background: catInfo.color, color: "white" }}>{verifiedRate}%可信</div>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card"><small>已核实</small><strong>{verifiedCount}/{evidenceCount}</strong><div className="progress"><div className="fill" style={{ width: `${verifiedRate}%`, background: catInfo.color }}></div></div></div>
          <div className="kpi-card"><small>待决策</small><strong>{decisions.length}</strong><small>需拍板</small></div>
          <div className="kpi-card"><small>风险</small><strong>{risks.length}</strong><small>需关注</small></div>
          <div className="kpi-card dark"><small>结论</small><strong>{report.summary?.slice(0, 20) || "暂无"}</strong><small>{catInfo.name}</small></div>
        </div>

        <div className="boss-summary">
          <span className="badge">老板摘要</span>
          <p><strong>结论：</strong>{report.summary?.slice(0, 100) || "暂无结论"} · <strong>依据：</strong>{evidenceCount}条结论，{verifiedCount}条已核实（{verifiedRate}%可信）{risks.length > 0 && ` · 风险${risks.length}个`}{decisions.length > 0 && ` · 待决策${decisions.length}个`}</p>
        </div>

        <div className="decision-card" style={{ borderLeftColor: catInfo.color }}>
          <strong>🎯 需要决策</strong>
          {decisions.slice(0, 2).map((d: any, i: number) => (
            <div key={i} className="decision-item"><span>{d.question || d.title}</span><small>{d.why || "需拍板"}</small></div>
          ))}
        </div>
      </div>
    );
  }

  if (role === "sales") {
    return (
      <div className="executive-report-rich sales">
        <div className="report-header">
          <h3>💼 {catInfo.icon} {catInfo.name}执行报告 · 销售视角 · 卖点工具</h3>
          <small>卖点突出 · 话术 · 工具箱 · {catInfo.name}专用</small>
        </div>

        <div className="selling-points">
          <div className="point-card">
            <strong>核心卖点</strong>
            <p>{category === "health_food" ? "蓝帽子备案+多酚功能+软糖口感，功效与口感兼具，199元高溢价" : category === "cross_border_food" ? "进口原料+跨境背书+保税仓直发，品质保障，129元中高端" : category === "cosmetics" ? "透明质酸保湿+烟酰胺美白+玻璃瓶质感，高端体验，299元" : "性价比突出+日常刚需+SC合规，安全放心，39.9元"}</p>
          </div>
          <div className="point-card">
            <strong>话术</strong>
            <p className="script">"{report.summary?.slice(0, 80) || "暂无结论"}，已核实{verifiedCount}/{evidenceCount}条，{verifiedRate}%可信，可直接用于客户沟通。"</p>
          </div>
        </div>

        <div className="evidence-sales">
          <strong>📊 证据卖点 · {verifiedRate}%可信</strong>
          <div className="evidence-grid">
            {conclusions.slice(0, 3).map((c: any, i: number) => (
              <div key={i} className="evidence-card"><strong>{c.fieldKey || `结论${i + 1}`}</strong><small>{c.value || c.summary} · {c.evidenceLevel}级</small></div>
            ))}
          </div>
        </div>

        <div className="sales-tools">
          <button className="primary">📋 复制卖点话术</button>
          <button>📤 导出销售资料</button>
          <button>💬 生成客户沟通稿</button>
        </div>
      </div>
    );
  }

  // Product - 严谨
  return (
    <div className="executive-report-rich product">
      <div className="report-header">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: catInfo.color, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>{catInfo.icon}</div>
          <div>
            <h3>{report.title || `${catInfo.name}执行报告`} · 产品研发视角 · 严谨可信</h3>
            <small>{catInfo.name}专用 · {evidenceCount}条结论 · {verifiedCount}已核实 · {verifiedRate}%可信 · 证据等级A-D · Kern调用 research_agent/scientific_evidence_agent</small>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h4>📊 证据等级分布</h4>
          <div className="donut-wrap">
            <svg viewBox="0 0 42 42" width="100" height="100">
              <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#f0f2f6" strokeWidth="3" />
              {[
                { v: levels.A, color: "#0b7a4f" },
                { v: levels.B, color: "#7c3aed" },
                { v: levels.C, color: "#f59e0b" },
                { v: levels.D, color: "#ef4444" },
              ].map((seg, i, arr) => {
                const total = Object.values(levels).reduce((a, b) => a + b, 0) || 1;
                const offset = arr.slice(0, i).reduce((acc, s) => acc + (s.v / total) * 100, 0);
                const dash = (seg.v / total) * 100;
                if (seg.v === 0) return null;
                return <circle key={i} cx="21" cy="21" r="15.9" fill="transparent" stroke={seg.color} strokeWidth="3.5" strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={25 - offset} strokeLinecap="round" style={{ animation: `drawDonut 1s ease-out ${i * 150}ms both` }} />;
              })}
              <text x="21" y="22" textAnchor="middle" fontSize="7" fontWeight="800">{verifiedRate}%</text>
              <text x="21" y="26" textAnchor="middle" fontSize="3" fill="#6b7280">可信</text>
            </svg>
            <div className="levels">
              <span><i style={{ background: "#0b7a4f" }}></i>A高可信 {levels.A}</span>
              <span><i style={{ background: "#7c3aed" }}></i>B较可信 {levels.B}</span>
              <span><i style={{ background: "#f59e0b" }}></i>C待加强 {levels.C}</span>
              <span><i style={{ background: "#ef4444" }}></i>D待核实 {levels.D}</span>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <h4>📈 结论完成度</h4>
          <div className="bars">
            <div className="bar"><span>已核实</span><div className="track"><div className="fill" style={{ width: `${verifiedRate}%`, background: catInfo.color }}></div></div><strong>{verifiedRate}%</strong></div>
            <div className="bar"><span>待加强</span><div className="track"><div className="fill" style={{ width: `${100 - verifiedRate}%`, background: "#f59e0b" }}></div></div><strong>{100 - verifiedRate}%</strong></div>
          </div>
        </div>
      </div>

      <div className="conclusions-table">
        <h4>🔬 结论明细 · 证据等级 · 来源 · 状态</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>字段</th><th>值</th><th>等级</th><th>来源</th><th>状态</th></tr></thead>
            <tbody>
              {conclusions.slice(0, 8).map((c: any, i: number) => (
                <tr key={i} style={{ animationDelay: `${i * 50}ms` }}>
                  <td>{c.fieldKey || `字段${i + 1}`}</td>
                  <td><strong>{c.value || c.summary?.slice(0, 30)}</strong> {c.unit || ""}</td>
                  <td><span className={`lvl ${c.evidenceLevel || "D"}`}>{c.evidenceLevel || "D"}</span></td>
                  <td>{c.source || "内部"}</td>
                  <td><span className="badge ok">已核实</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {risks.length > 0 && (
        <div className="risks">
          <h4>⚠️ 风险 · {risks.length}个</h4>
          {risks.slice(0, 3).map((r: any, i: number) => (
            <div key={i} className="risk-item"><strong>{r.title || r.description?.slice(0, 30)}</strong><small>{r.description || r.impact}</small></div>
          ))}
        </div>
      )}

      {decisions.length > 0 && (
        <div className="decisions">
          <h4>🎯 待决策 · {decisions.length}个</h4>
          {decisions.slice(0, 3).map((d: any, i: number) => (
            <div key={i} className="decision-item"><strong>{d.question || d.title}</strong><small>{d.why || "需拍板"}</small><div className="options">{(d.options || []).slice(0, 2).map((o: any, j: number) => <button key={j}>{o.label || o}</button>)}</div></div>
          ))}
        </div>
      )}
    </div>
  );
}
