"use client";
import type { ChatBrief } from "@/modules/muse/types";
import { WORK_PERSPECTIVES, type WorkPerspective } from "@/modules/workspace/perspective";
export function WorkBrief({ attention, role }: { attention: ChatBrief["attention"]; role: WorkPerspective }) {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  return <section className="kern-home-brief" aria-label="当前工作简报">
    <div className="kern-brief-heading"><span>工作摘要</span><a href="/manage">查看工作台 <span aria-hidden>↗</span></a></div>
    <div className="kern-home-stats">
      <button type="button" onClick={() => jump("home-needs")} disabled={attention.needsYou.length === 0}>
        <strong>{attention.unavailable && !attention.needsYou.length ? "—" : attention.needsYou.length}</strong><span>需要你处理</span><small>{attention.needsYou.length > 0 ? "查看待办 ↓" : attention.unavailable ? "状态待更新" : "暂无待办"}</small>
      </button>
      <button type="button" onClick={() => jump("home-doing")} disabled={attention.inProgress.length === 0}>
        <strong>{attention.unavailable && !attention.inProgress.length ? "—" : attention.inProgress.length}</strong><span>Kern 正在推进</span><small>{attention.inProgress.length > 0 ? "查看进度 ↓" : attention.unavailable ? "状态待更新" : "等待新的目标"}</small>
      </button>
      <div><strong>{attention.completedRecently ?? "—"}</strong><span>过去一天完成</span><small>当前可见工作记录</small></div>
    </div>
    {attention.unavailable ? <p className="kern-state-note" role="status">部分状态未能读取，刷新可重试。已读取事项仍显示在下方。</p> :
      <p className="kern-brief-caption">{WORK_PERSPECTIVES.find(item => item.value === role)!.focus} · 打开页面时更新</p>}
  </section>;
}
