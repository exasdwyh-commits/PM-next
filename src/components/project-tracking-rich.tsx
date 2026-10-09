"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { labelProjectTimelineStatus } from "@/shared/status-labels";
import "./project-tracking-rich.css";
import { DependencyGraphRich } from "./dependency-graph-rich";
import { categoryMeta } from "@/modules/tenant";

export function ProjectTrackingRich({ tracking, category = "health_food", onAction }: any) {
  const { role } = useRole();
  const catInfo = categoryMeta(category);
  const [activeView, setActiveView] = React.useState<"timeline" | "graph" | "list">("timeline");

  const data = tracking || {
    projectTitle: "多酚软糖项目",
    progress: 62,
    doneWork: 5,
    totalWork: 8,
    decisions: 2,
    gaps: 4,
    risks: 1,
    nextStep: "成本优化到8元以内",
    owner: "张三",
    estimatedLaunch: "2024-11-15",
    timeline: [
      { key: "formula", label: "配方确定", status: "done", date: "2024-10-01", desc: "多酚+低聚果糖+软糖基质" },
      { key: "cost", label: "成本优化", status: "running", desc: "目标8元 · Kern调度中" },
      { key: "compliance", label: "合规检查", status: "queued", desc: "蓝帽子认证 · 依赖成本优化" },
      { key: "supplier", label: "供应商打样", status: "queued", desc: "3家供应商 · 依赖合规" },
      { key: "launch", label: "测试+上市", status: "queued", date: "2024-11-15", desc: "预计上市" },
    ],
    criticalPath: "配方确定 → 成本优化 → 合规检查 → 供应商打样 → 测试+上市 · 总计45天 · 当前进度62%",
  };

  return (
    <div className="project-tracking-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="tracking-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>
            {catInfo.icon} {catInfo.name} · 项目跟踪 · 进度{data.progress}% · 自动推进 · {role}视角
          </span>
          <h2>{data.projectTitle} · 进度{data.progress}% · {data.doneWork}/{data.totalWork}已完成 · 负责人{data.owner}</h2>
          <small>下一步: {data.nextStep} · 预计上市{data.estimatedLaunch} · {data.decisions}待决策 {data.gaps}缺口 · {catInfo.name}专用 · Kern统筹</small>
        </div>
        <div className="tracking-kpi">
          <div className="kpi-mini"><strong>{data.progress}%</strong><small>进度</small></div>
          <div className="kpi-mini"><strong>{data.decisions}</strong><small>待决策</small></div>
          <div className="kpi-mini"><strong>{data.gaps}</strong><small>缺口</small></div>
        </div>
      </div>

      <div className="tracking-tabs">
        <button className={activeView === "timeline" ? "is-active" : ""} onClick={() => setActiveView("timeline")} style={{ borderColor: activeView === "timeline" ? catInfo.color : undefined } as any}>📅 时间线</button>
        <button className={activeView === "graph" ? "is-active" : ""} onClick={() => setActiveView("graph")} style={{ borderColor: activeView === "graph" ? catInfo.color : undefined } as any}>🕸️ 依赖图</button>
        <button className={activeView === "list" ? "is-active" : ""} onClick={() => setActiveView("list")} style={{ borderColor: activeView === "list" ? catInfo.color : undefined } as any}>📋 任务列表</button>
      </div>

      {activeView === "timeline" && (
        <div className="tracking-timeline">
          <div className="timeline-grid">
            {data.timeline.map((item: any, idx: number) => {
              const statusCfg = item.status === "done" ? { color: "#0b7a4f", bg: "#ecfdf5", label: "已完成" } : item.status === "running" ? { color: "#f59e0b", bg: "#fffbeb", label: "进行中" } : { color: "#6b7280", bg: "#f9fafb", label: "待开始" };
              return (
                <div key={item.key} className={`timeline-item ${item.status}`} style={{ animationDelay: `${idx * 80}ms`, borderLeft: `3px solid ${statusCfg.color}`, background: statusCfg.bg } as any}>
                  <div className="dot" style={{ background: statusCfg.color }}></div>
                  <div className="item-content">
                    <strong>{item.label}</strong>
                    <small>{item.desc} {item.date ? `· ${item.date}` : ""} · {catInfo.name}</small>
                  </div>
                  <span className="status-badge" style={{ background: statusCfg.color, color: "white" }}>{statusCfg.label}</span>
                </div>
              );
            })}
          </div>
          <div className="critical-path" style={{ borderColor: catInfo.color, background: `${catInfo.color}08` }}>
            <strong>🔥 关键路径:</strong> {data.criticalPath} · {catInfo.name}专用 · 自动推进已启用
          </div>
        </div>
      )}

      {activeView === "graph" && (
        <DependencyGraphRich category={category} onAutoAdvance={() => onAction?.("auto-advance")} />
      )}

      {activeView === "list" && (
        <div className="tracking-list">
          <div className="list-header">
            <small>任务列表 · {data.totalWork}项 · {data.doneWork}已完成 · 虚拟化1000+不卡顿 · {catInfo.icon} {catInfo.name}</small>
          </div>
          <div className="task-grid">
            {data.timeline.map((t: any, i: number) => (
              <div key={t.key} className="task-card" style={{ animationDelay: `${i * 60}ms`, borderLeft: `3px solid ${catInfo.color}` } as any}>
                <strong>{t.label}</strong>
                <small>{t.desc}</small>
                <div className="task-meta">
                  <span className={`status ${t.status}`}>{labelProjectTimelineStatus(t.status)}</span>
                  <button style={{ background: catInfo.color, color: "white" }} onClick={() => onAction?.(t.key)}>推进</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tracking-actions">
        <button className="primary" style={{ background: catInfo.color }} onClick={() => onAction?.("auto-advance")}>🚀 自动推进 · 解阻塞</button>
        <button className="outline" onClick={() => onAction?.("evidence")}>🔬 补证据 · {data.gaps}个</button>
        <button className="outline" onClick={() => onAction?.("decisions")}>📝 决策 · {data.decisions}项</button>
        <button className="outline" onClick={() => onAction?.("cost")}>💰 成本优化</button>
      </div>

      <div className="tracking-insight" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
        <strong>💡 Kern洞察 · {catInfo.icon} {catInfo.name} · 自动推进</strong>
        <p>当前阻塞：成本偏高需优化到8元以内，Kern已调度 cost_bom_agent + supplier_agent，完成后自动触发合规检查。关键路径剩余 {data.totalWork - data.doneWork} 项，预计 {data.estimatedLaunch} 上市。</p>
        <div className="insight-chips">
          <span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>成本→合规 自动</span>
          <span style={{ background: "#f59e0b15", color: "#f59e0b" }}>合规→供应商 排队</span>
          <span style={{ background: "#0b7a4f15", color: "#0b7a4f" }}>配方→成本 已完成</span>
        </div>
      </div>
    </div>
  );
}
