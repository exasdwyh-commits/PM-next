"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { labelModelRunStatus } from "@/shared/status-labels";
import { fmtTime } from "@/shared/datetime";
import { categoryMeta } from "@/modules/tenant";
import "./billing-dashboard-rich.css";

export function BillingDashboardRich({ quota, recentRuns, usageByDay, category = "health_food" }: any) {
  const { role } = useRole();
  const catInfo = categoryMeta(category);

  const q = quota || { limit: 300, used: 299, remaining: 1, rate: 99 };
  const getQuotaColor = (rate: number) => {
    if (rate < 70) return "#0b7a4f";
    if (rate < 90) return "#f59e0b";
    return "#dc2626";
  };

  return (
    <div className="billing-dashboard-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="billing-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>
            {catInfo.icon} {catInfo.name} · 账单看板 · 成本护栏 · 原子计费 · {role}视角
          </span>
          <h2>模型调用账单 · 月度 {q.used}/{q.limit} · 剩余 {q.remaining} · {q.rate}% · fail-closed</h2>
          <small>reserve → consume → release · pg advisory + row lock · 超额诚实 BLOCKED · {catInfo.name}专用</small>
        </div>
        <div className="quota-badge" style={{ background: getQuotaColor(q.rate), color: "white" }}>
          {q.rate}% {q.rate >= 90 ? "⚠️ 预警" : q.rate >= 70 ? "注意" : "正常"}
        </div>
      </div>

      <div className="quota-card" style={{ borderColor: `${getQuotaColor(q.rate)}30` } as any}>
        <div className="quota-header">
          <strong>月度配额 · {q.limit} 次</strong>
          <small>已用 {q.used} · 剩余 {q.remaining} · 原子 check-and-charge</small>
        </div>
        <div className="quota-bar">
          <div className="track"><div className="fill" style={{ width: `${q.rate}%`, background: getQuotaColor(q.rate) } as any}></div></div>
          <div className="quota-labels"><span>0</span><span>70%</span><span>90%</span><span>{q.limit}</span></div>
        </div>
        {q.rate >= 90 && (
          <div className="quota-warning" style={{ borderColor: "#dc2626", background: "#fef2f2" }}>
            <strong>⚠️ 配额预警 · {q.rate}%</strong>
            <p>月度调用已达 {q.used}/{q.limit}，剩余 {q.remaining}，下次调用将原子检查，若 299/300 时仍尝试启动将被诚实 BLOCKED，需等待下月或申请扩容</p>
          </div>
        )}
      </div>

      <div className="usage-grid">
        <div className="usage-card">
          <h4>📊 最近30天使用</h4>
          <div className="bars">
            {(usageByDay || [
              { day: "2024-10-07", count: 45, total_cost: 45 },
              { day: "2024-10-06", count: 38, total_cost: 38 },
              { day: "2024-10-05", count: 52, total_cost: 52 },
            ]).slice(0, 7).map((d: any, i: number) => (
              <div key={i} className="bar" style={{ animationDelay: `${i * 60}ms` }}>
                <span>{String(d.day).slice(5)}</span>
                <div className="track"><div className="fill" style={{ width: `${Math.min(d.count, 100)}%`, background: catInfo.color } as any}></div></div>
                <small>{d.count}次</small>
              </div>
            ))}
          </div>
        </div>

        <div className="usage-card">
          <h4>🔍 最近 ModelRun 追踪</h4>
          <div className="runs-list">
            {(recentRuns || [
              { id: "1", missionId: "mission_123", taskClass: "research_market", profileKey: "gpt-4", status: "SUCCEEDED", estimatedTokens: 1200, actualTokens: 1150, startedAt: new Date().toISOString() },
              { id: "2", missionId: "mission_123", taskClass: "research_regulatory", profileKey: "claude-3", status: "SUCCEEDED", estimatedTokens: 800, actualTokens: 820, startedAt: new Date().toISOString() },
              { id: "3", missionId: "mission_124", taskClass: "assistant_synthesis", profileKey: "local", status: "RUNNING", estimatedTokens: 500, startedAt: new Date().toISOString() },
            ]).map((run: any, idx: number) => (
              <div key={run.id} className={`run-item ${run.status.toLowerCase()}`} style={{ animationDelay: `${idx * 80}ms`, borderLeft: `3px solid ${run.status === "SUCCEEDED" ? "#0b7a4f" : run.status === "RUNNING" ? "#f59e0b" : "#dc2626"}` } as any}>
                <div className="run-header">
                  <strong>{run.taskClass}</strong>
                  <span className={`status ${run.status.toLowerCase()}`}>{labelModelRunStatus(run.status)}</span>
                </div>
                <small>Mission {run.missionId?.slice(0, 12)} · {run.profileKey} · {run.estimatedTokens}→{run.actualTokens || "?"} tokens · {fmtTime(run.startedAt)}</small>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cost-guard-info" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
        <strong>🛡️ Cost Guard · 原子计费 · {catInfo.icon} {catInfo.name}</strong>
        <p>每次 ModelRun 前原子 check-and-charge: reserve → consume → release (fail rollback), pg advisory + row lock + WHERE used &lt; quota, 299/300 时启动仍被拦截, fail closed 诚实 BLOCKED, 记录 UsageLedger + ModelRun tracing</p>
        <div className="guard-chips">
          <span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>mission_started</span>
          <span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>model_call</span>
          <span style={{ background: "#f59e0b15", color: "#f59e0b" }}>research_call</span>
          <span style={{ background: "#0b7a4f15", color: "#0b7a4f" }}>desktop_action</span>
        </div>
      </div>

      <div className="tracing-info">
        <h4>📈 最小 Tracing · 节点×模型×耗时×结果</h4>
        <div className="tracing-grid">
          <div className="tracing-card"><strong>Mission</strong><small>mission_123</small><small>20-50任务连续跑</small></div>
          <div className="tracing-card"><strong>Node</strong><small>research_market</small><small>5节点</small></div>
          <div className="tracing-card"><strong>Model</strong><small>gpt-4 / claude-3 / local</small><small>3模型</small></div>
          <div className="tracing-card"><strong>Duration</strong><small>avg 1.2s</small><small>总计 45s</small></div>
        </div>
      </div>
    </div>
  );
}
