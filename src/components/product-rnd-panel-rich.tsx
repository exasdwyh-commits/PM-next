"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { fmtDate } from "@/shared/datetime";
import "./product-rnd-panel-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777" },
};

export function ProductRndPanelRich({ project, workItems = [], evidences = [] }: any) {
  const { role } = useRole();
  const category = React.useMemo(() => {
    const text = (project?.title || "" + project?.target || "").toLowerCase();
    if (text.includes("多酚") || text.includes("保健") || text.includes("胶囊")) return "health_food";
    if (text.includes("跨境") || text.includes("进口")) return "cross_border_food";
    if (text.includes("化妆") || text.includes("护肤")) return "cosmetics";
    return "regular_food";
  }, [project]);

  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.regular_food;
  const doneCount = workItems.filter((w: any) => w.status === "ACCEPTED").length;
  const totalCount = workItems.length;
  const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  if (role === "leadership") {
    return (
      <div className="product-rnd-rich leadership" style={{ borderColor: catInfo.color }}>
        <h4>🔬 AI研发 · {doneCount}/{totalCount} · {progress}% · {catInfo.icon} {catInfo.name}</h4>
        <div className="progress-bar"><div className="fill" style={{ width: `${progress}%`, background: catInfo.color }}></div><span>{progress}%</span></div>
        <div className="rnd-kpi">
          <span>已完成 {doneCount}</span>
          <span>进行中 {totalCount - doneCount}</span>
          <span>证据 {evidences.length}</span>
        </div>
      </div>
    );
  }

  if (role === "sales") {
    return (
      <div className="product-rnd-rich sales">
        <h4>💼 AI研发卖点 · {catInfo.icon} {catInfo.name}</h4>
        <div className="selling-card">
          <strong>研发卖点</strong>
          <p>{category === "health_food" ? "AI研发多酚软糖，80度烘焙82%留存验证，功能+口感，蓝帽子备案" : category === "cross_border_food" ? "AI研发跨境坚果，进口原料溯源，保税仓直发" : category === "cosmetics" ? "AI研发玻尿酸精华，透明质酸+烟酰胺，功效安全验证" : "AI研发燕麦饼干，性价比优化，SC合规"}，已完成{doneCount}/{totalCount}，{progress}%进度。</p>
        </div>
        <div className="tool-box">
          <button>📋 复制研发卖点</button>
          <button>📤 导出研发资料</button>
        </div>
      </div>
    );
  }

  return (
    <div className="product-rnd-rich product" data-role={role}>
      <div className="rnd-header">
        <div>
          <h4>🔬 AI研发面板 · {catInfo.icon} {catInfo.name} · 4类专用 · 富可视化</h4>
          <small>进度 {doneCount}/{totalCount} ({progress}%) · 证据 {evidences.length} · 15组件+8动效 · Kern调度 research_agent/formulation_agent/scientific_evidence_agent</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>

      <div className="progress-bar"><div className="fill" style={{ width: `${progress}%`, background: catInfo.color }}></div><span>{progress}%</span></div>

      <div className="work-grid">
        {workItems.slice(0, 6).map((work: any, idx: number) => (
          <div key={work.id || idx} className={`work-card ${work.status?.toLowerCase()}`} style={{ animationDelay: `${idx * 80}ms` }}>
            <div className="work-h">
              <strong>{work.title || work.goal || `任务${idx + 1}`}</strong>
              <span className={`status ${work.status?.toLowerCase()}`}>{work.status === "ACCEPTED" ? "✅ 已完成" : work.status === "RUNNING" ? "⏳ 进行中" : "📝 待做"}</span>
            </div>
            <small>{work.description || work.output?.slice(0, 60) || "AI研发任务"}</small>
            <div className="work-meta">
              <span>{work.agent || "AI Agent"}</span>
              <span>{work.updatedAt ? fmtDate(work.updatedAt) : "-"}</span>
            </div>
          </div>
        ))}
        {workItems.length === 0 && <div className="empty">暂无研发任务，Kern已调度专业Agent</div>}
      </div>

      <div className="evidence-section">
        <h5>📚 证据 · {evidences.length}条 · {catInfo.name}专用</h5>
        <div className="evidence-grid">
          {evidences.slice(0, 4).map((ev: any, idx: number) => (
            <div key={ev.id || idx} className="evidence-card" style={{ animationDelay: `${idx * 60}ms` }}>
              <strong>{ev.title || `证据${idx + 1}`}</strong>
              <small>{ev.summary?.slice(0, 40) || "证据摘要"} · {ev.verifyStatus || "待核实"}</small>
              <span className={`lvl ${ev.evidenceLevel || "C"}`}>{ev.evidenceLevel || "C"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rnd-charts">
        <div className="chart-card">
          <h5>📊 研发进度</h5>
          <div className="bar"><span>已完成</span><div className="track"><div className="fill" style={{ width: `${progress}%`, background: catInfo.color }}></div></div><strong>{progress}%</strong></div>
          <div className="bar"><span>进行中</span><div className="track"><div className="fill" style={{ width: `${100 - progress}%`, background: "#f59e0b" }}></div></div><strong>{100 - progress}%</strong></div>
        </div>
        <div className="chart-card">
          <h5>📚 证据可信度</h5>
          <div className="donut">
            <svg viewBox="0 0 42 42" width="60" height="60"><circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#f0f2f6" strokeWidth="3" /><circle cx="21" cy="21" r="15.9" fill="transparent" stroke={catInfo.color} strokeWidth="3.5" strokeDasharray={`${progress} ${100 - progress}`} strokeDashoffset="25" strokeLinecap="round" /><text x="21" y="22" textAnchor="middle" fontSize="6" fontWeight="700">{progress}%</text></svg>
            <div><strong>{doneCount}已完成</strong><small>共{totalCount} · {catInfo.name}</small></div>
          </div>
        </div>
      </div>
    </div>
  );
}
