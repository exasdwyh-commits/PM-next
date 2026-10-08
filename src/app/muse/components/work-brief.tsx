"use client";
import type { ChatBrief } from "@/modules/muse/types";
import { WORK_PERSPECTIVES, type WorkPerspective } from "@/modules/workspace/perspective";
import { VisualCount, WorkDistribution } from "./advanced-visuals";
export function WorkBrief({ attention, role }: { attention: ChatBrief["attention"]; role: WorkPerspective }) {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  const needs = attention.needsYou.length;
  const active = attention.inProgress.length;
  const max = Math.max(needs, active, 1);
  return <section className="kern-home-brief ka-bento" aria-label="当前工作简报">
    <div className="kern-brief-heading"><span>你的工作概览</span><a href="/manage">查看工作台 <span aria-hidden>↗</span></a></div>
    <div className="kern-home-stats">
      <button type="button" onClick={() => jump("home-needs")} disabled={needs === 0}>
        <span className="ka-stat-label">需要你处理</span><strong>{attention.unavailable && !needs ? "—" : <VisualCount value={needs} />}</strong><small>{needs > 0 ? "查看待办 ↓" : attention.unavailable ? "状态待更新" : "暂无待办"}</small>
      </button>
      <button type="button" onClick={() => jump("home-doing")} disabled={active === 0}>
        <span className="ka-stat-label">Kern 正在推进</span><strong>{attention.unavailable && !active ? "—" : <VisualCount value={active} />}</strong><small>{active > 0 ? "查看进度 ↓" : attention.unavailable ? "状态待更新" : "等待新的目标"}</small>
      </button>
      <div><span className="ka-stat-label">过去一天完成</span><strong>{attention.completedRecently == null ? "—" : <VisualCount value={attention.completedRecently} />}</strong><small>当前可见工作记录</small></div>
    </div>
    <div className="ka-chart-grid">
      <div className="ka-glass"><WorkDistribution needs={needs} active={active} unavailable={attention.unavailable} /></div>
      <div className="ka-glass ka-status-bars"><h3>待办与执行</h3>{[{ label: "推进中", count: active, tone: "active" }, { label: "待处理", count: needs, tone: "needs" }].map(item => <div className="ka-bar-row" key={item.label}><div><span>{item.label}</span><b>{item.count} 项</b></div><div className="ka-bar-track"><i data-tone={item.tone} style={{ width: `${item.count / max * 100}%` }} /></div></div>)}<small>{attention.unavailable ? "部分状态待更新，图表仅展示已读取事项。" : needs + active ? "点击上方卡片，继续处理当前事项。" : "说一个目标，让 Kern 开始工作。"}</small></div>
    </div>
    {attention.unavailable ? <p className="kern-state-note" role="status">部分状态未能读取，刷新可重试。已读取事项仍显示在下方。</p> : <p className="kern-brief-caption">{WORK_PERSPECTIVES.find(item => item.value === role)!.focus} · 打开页面时更新</p>}
  </section>;
}
