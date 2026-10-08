"use client";

import * as React from "react";
import { useRole } from "./role-context";
import "./collaboration-planner-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777" },
};

export function CollaborationPlannerRich({ plan, steps = [], category = "health_food" }: any) {
  const { role } = useRole();
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const doneCount = steps.filter((s: any) => s.status === "done" || s.status === "SUCCEEDED").length;
  const totalCount = steps.length;
  const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  if (role === "leadership") {
    return (
      <div className="collab-planner-rich leadership" style={{ borderColor: catInfo.color }}>
        <h4>🤝 协作规划 · {doneCount}/{totalCount} · {progress}% · {catInfo.icon} {catInfo.name}</h4>
        <div className="progress-bar"><div className="fill" style={{ width: `${progress}%`, background: catInfo.color }}></div><span>{progress}%</span></div>
        <div className="plan-summary">
          <strong>{plan?.goal?.slice(0, 60) || "协作目标"}</strong>
          <small>{totalCount}个步骤 · {doneCount}已完成 · Kern调度</small>
        </div>
      </div>
    );
  }

  if (role === "sales") {
    return (
      <div className="collab-planner-rich sales">
        <h4>💼 协作卖点 · {catInfo.icon} {catInfo.name}</h4>
        <div className="selling-card">
          <strong>协作优势</strong>
          <p>Kern调度{totalCount}个专家，{doneCount}已完成，{progress}%进度，{catInfo.name}专用，供应链+合规+研发协同，保障交付。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="collab-planner-rich product">
      <div className="planner-header">
        <div>
          <h4>🤝 协作规划 · {catInfo.icon} {catInfo.name} · 富可视化 · {progress}%</h4>
          <small>{plan?.goal?.slice(0, 80) || "协作目标"} · {totalCount}步骤 · {doneCount}完成 · Kern调度</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>

      <div className="progress-bar"><div className="fill" style={{ width: `${progress}%`, background: catInfo.color }}></div><span>{progress}%</span></div>

      <div className="steps-timeline">
        {steps.map((step: any, idx: number) => (
          <div key={step.key || idx} className={`step-item ${step.status?.toLowerCase() || "queued"}`} style={{ animationDelay: `${idx * 80}ms` }}>
            <div className="step-dot" style={{ background: step.status === "done" || step.status === "SUCCEEDED" ? catInfo.color : step.status === "running" || step.status === "RUNNING" ? "#f59e0b" : "#e7e9ef" }}></div>
            <div className="step-content">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{step.label || step.key || `步骤${idx + 1}`}</strong>
                <span className="agent">{step.agent || "Agent"}</span>
              </div>
              <small>{step.description || step.delta || "协作步骤"}</small>
              {step.status === "running" && <div className="running-bar"><div className="fill" style={{ background: catInfo.color }}></div></div>}
            </div>
          </div>
        ))}
      </div>

      <div className="planner-stats">
        <div className="stat"><strong>{doneCount}</strong><small>已完成</small></div>
        <div className="stat"><strong>{totalCount - doneCount}</strong><small>进行中</small></div>
        <div className="stat"><strong>{progress}%</strong><small>进度</small></div>
        <div className="stat"><strong>{catInfo.name}</strong><small>类别</small></div>
      </div>
    </div>
  );
}
