"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { categoryMeta, categoryContent } from "@/modules/tenant";
import "./daily-briefing-rich.css";

export interface DailyBriefingData {
  todos: number;
  decisions: number;
  gaps: number;
  risks: number;
  evidenceRate: number;
  workRate: number;
  verifiedCount: number;
  totalEvidence: number;
  doneWork: number;
  totalWork: number;
  category?: string;
  projectTitle?: string;
  suggestions?: string[];
  generatedAt?: string;
}

export function DailyBriefingRich({ data, onAction }: { data: DailyBriefingData; onAction?: (action: string) => void }) {
  const { role, setManualRole } = useRole();
  const category = data.category || "health_food";
  const catInfo = categoryMeta(category);
  // 同 overview-role-based：本组件原本只展示前 3 条卖点，显式截取以保持数组长度一致。
  const selling = categoryContent(category).selling.slice(0, 3);
  const timeGreeting = new Date().getHours() < 12 ? "早上好" : new Date().getHours() < 18 ? "下午好" : "晚上好";

  if ((role as string) === "leadership") {
    return (
      <div className="daily-briefing-rich leadership" style={{ borderColor: catInfo.color }}>
        <div className="briefing-header" style={{ background: catInfo.gradient }}>
          <div>
            <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name} · 每日简报 · {timeGreeting} · 领导视角 · 富可视化</span>
            <h2>{timeGreeting}，今日有 {data.decisions} 项待决策，{data.gaps} 个缺口需关注</h2>
            <small>Kern智能统筹 · {data.projectTitle || "多酚软糖项目"} · {catInfo.name}专用 · 一页看懂</small>
          </div>
          <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
        </div>

        <div className="kpi-grid">
          <div className="kpi ok" style={{ animationDelay: "0ms" }}><span>✅ 已核实证据</span><strong>{data.verifiedCount}/{data.totalEvidence}</strong><small>{data.evidenceRate}%可信 · {selling[0]}</small><div className="kpi-bar"><div className="fill" style={{ width: `${data.evidenceRate}%`, background: catInfo.color }}></div></div></div>
          <div className="kpi brand" style={{ animationDelay: "80ms" }}><span>📝 工作进度</span><strong>{data.doneWork}/{data.totalWork}</strong><small>{data.workRate}%完成</small><div className="kpi-bar"><div className="fill" style={{ width: `${data.workRate}%`, background: "#2563eb" }}></div></div></div>
          <div className="kpi warn" style={{ animationDelay: "160ms" }}><span>📍 待决策</span><strong>{data.decisions}</strong><small>需拍板 · {data.suggestions?.[0]?.slice(0, 12) || "今日处理"}</small></div>
          <div className="kpi bad" style={{ animationDelay: "240ms" }}><span>⚠️ 缺口/风险</span><strong>{data.gaps + data.risks}</strong><small>{data.gaps}缺口+{data.risks}风险</small></div>
        </div>

        <div className="boss-summary" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
          <strong>💡 老板一句话结论 · {catInfo.icon} {catInfo.name}</strong>
          <p>{data.projectTitle || "多酚软糖项目"}还有{data.gaps}个缺口需解决，{data.decisions}项待决策，证据可信度{data.evidenceRate}%，{selling.join("、")}，建议今日推进{data.suggestions?.[0] || "成本优化"}，可进入下一阶段。</p>
          <div className="suggestion-chips">
            {data.suggestions?.slice(0, 3).map((s, i) => <span key={i} style={{ background: `${catInfo.color}15`, color: catInfo.color }}>{s}</span>)}
          </div>
        </div>

        <div className="quick-actions">
          <button className="primary" style={{ background: catInfo.color }} onClick={() => onAction?.("evidence")}>去补证据 · {data.gaps}个</button>
          <button className="outline" onClick={() => onAction?.("decisions")}>去做决策 · {data.decisions}项</button>
          <button className="outline" onClick={() => onAction?.("rnd")}>查看AI研发</button>
        </div>

        <div className="role-switch-hint">
          <small>💡 领导视角极简，专注结论。试试说&quot;切换到研发视角&quot;或&quot;切换到销售视角&quot;，或手动：</small>
          <div className="role-switch">
            <button className={(role as string) === "leadership" ? "is-active" : ""} onClick={() => setManualRole("leadership")}>👔 领导</button>
            <button className={(role as string) === "product" ? "is-active" : ""} onClick={() => setManualRole("product")}>🔬 研发</button>
            <button className={(role as string) === "sales" ? "is-active" : ""} onClick={() => setManualRole("sales")}>💼 销售</button>
          </div>
        </div>
      </div>
    );
  }

  if ((role as string) === "sales") {
    return (
      <div className="daily-briefing-rich sales" style={{ background: catInfo.gradient, borderColor: catInfo.color }}>
        <div className="briefing-header">
          <span className="badge" style={{ background: catInfo.color, color: "white" }}>💼 销售视角 · {catInfo.icon} {catInfo.name} · 每日简报 · {timeGreeting}</span>
          <h2>{data.projectTitle || "多酚软糖"} · 销售简报 · {data.verifiedCount}条证据已核实 · {data.workRate}%完成</h2>
          <p>今日待办{data.todos}项 · 待决策{data.decisions}项 · 缺口{data.gaps}个 · {selling.join(" · ")} · Kern已提炼卖点</p>
        </div>

        <div className="selling-points">
          <h3>💎 今日核心卖点 · {catInfo.name}专用</h3>
          <div className="sales-grid">
            <div className="sales-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}><span className="icon">{catInfo.icon}</span><div><strong>{selling[0]}，{selling[1]}</strong><small>客户价值：{selling[0]}符合趋势 · 已核实{data.verifiedCount}条证据</small><small>📎 依据：lab_test · 可写入话术</small></div></div>
            <div className="sales-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}><span className="icon">💰</span><div><strong>成本10.2元，竞品{category === "health_food" ? "199" : category === "cosmetics" ? "299" : category === "cross_border_food" ? "129" : "39.9"}元</strong><small>客户价值：高利润空间 · {data.workRate}%工作完成</small><small>📎 依据：cost_bom_agent · 可写入报价单</small></div></div>
          </div>
        </div>

        <div className="sales-tools">
          <button style={{ background: catInfo.color, color: "white" }} onClick={() => onAction?.("ppt")}>📽️ 生成销售PPT</button>
          <button onClick={() => onAction?.("script")}>📝 销售话术</button>
          <button onClick={() => onAction?.("battlecard")}>⚔️ 竞品对比卡</button>
          <button onClick={() => onAction?.("quote")}>💰 报价单</button>
        </div>

        <div className="script-hint" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
          <strong>💬 今日推荐话术 · {catInfo.icon} {catInfo.name}</strong>
          <p>&quot;{data.projectTitle || "多酚软糖"}经过{data.verifiedCount}条证据核实，{selling[0]}{selling[1]}，成本仅10.2元，竞品均价{category === "health_food" ? "199" : "299"}元，利润空间大。建议首批1000盒试销。&quot;</p>
          <small>一键复制 · {catInfo.name}专用 · Kern生成 · {timeGreeting}可用</small>
        </div>
      </div>
    );
  }

  // product
  return (
    <div className="daily-briefing-rich product" style={{ borderColor: catInfo.color }}>
      <div className="briefing-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name} · 每日简报 · {timeGreeting} · 研发视角 · 富可视化 · 15组件+8动效</span>
          <h2>{data.projectTitle || "多酚软糖项目"} · 研发简报 · 证据{data.verifiedCount}/{data.totalEvidence} · 工作{data.doneWork}/{data.totalWork} · 缺口{data.gaps}</h2>
          <small>Kern智能统筹 · {catInfo.name}专用 · 专业严谨 · research_agent/scientific_evidence_agent/formulation_agent/cost_bom_agent已调度</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>

      <div className="kpi-grid">
        <div className="kpi ok" style={{ animationDelay: "0ms" }}><span>✅ 已核实证据</span><strong>{data.verifiedCount}/{data.totalEvidence}</strong><small>{data.evidenceRate}%可信 · A/B级</small><div className="kpi-bar"><div className="fill" style={{ width: `${data.evidenceRate}%`, background: catInfo.color }}></div></div></div>
        <div className="kpi brand" style={{ animationDelay: "80ms" }}><span>📝 工作进度</span><strong>{data.doneWork}/{data.totalWork}</strong><small>{data.workRate}%完成 · {data.doneWork}已验收</small><div className="kpi-bar"><div className="fill" style={{ width: `${data.workRate}%`, background: "#2563eb" }}></div></div></div>
        <div className="kpi warn" style={{ animationDelay: "160ms" }}><span>📍 待决策</span><strong>{data.decisions}</strong><small>IN_REVIEW · 需G1/G2</small></div>
        <div className="kpi bad" style={{ animationDelay: "240ms" }}><span>⚠️ 缺口</span><strong>{data.gaps}</strong><small>UNKNOWN · 需补证</small></div>
      </div>

      <div className="charts">
        <div className="chart-card">
          <h4>📊 证据可信度 · {catInfo.name}</h4>
          <div className="donut">
            <svg viewBox="0 0 42 42" width="100" height="100"><circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#f0f2f6" strokeWidth="3" /><circle cx="21" cy="21" r="15.9" fill="transparent" stroke={catInfo.color} strokeWidth="3.5" strokeDasharray={`${data.evidenceRate} ${100 - data.evidenceRate}`} strokeDashoffset="25" strokeLinecap="round" style={{ animation: "drawDonut 1s ease-out both" } as any} /><text x="21" y="22" textAnchor="middle" fontSize="7" fontWeight="700">{data.evidenceRate}%</text></svg>
            <div><strong>{data.verifiedCount}条已核实</strong><small>共{data.totalEvidence}条 · Kern已核验 · A/B级{data.verifiedCount} · {catInfo.name}专用</small><div className="selling-chips">{selling.map(s => <span key={s} style={{ background: `${catInfo.color}15`, color: catInfo.color }}>{s}</span>)}</div></div>
          </div>
        </div>
        <div className="chart-card">
          <h4>📈 工作进度 · Kern调度 · 15组件+8动效</h4>
          <div className="bar"><span>已完成</span><div className="track"><i style={{ width: `${data.workRate}%`, background: catInfo.color } as any} /></div><strong>{data.workRate}%</strong></div>
          <div className="bar"><span>待验收</span><div className="track"><i style={{ width: `${100 - data.workRate}%`, background: "#f2ddb6" } as any} /></div><strong>{100 - data.workRate}%</strong></div>
          <div className="mini-stats"><div className="mini-stat"><strong>{data.doneWork}</strong><small>已完成</small></div><div className="mini-stat"><strong>{data.totalWork - data.doneWork}</strong><small>进行中</small></div><div className="mini-stat"><strong>{data.decisions}</strong><small>待决策</small></div><div className="mini-stat"><strong>{data.gaps}</strong><small>缺口</small></div></div>
        </div>
      </div>

      <div className="suggestions">
        <h4>💡 Kern建议 · {catInfo.name}专用 · 下一步</h4>
        <div className="suggestion-list">
          {data.suggestions?.map((s, i) => (
            <div key={i} className="suggestion-item" style={{ animationDelay: `${i * 80}ms`, borderLeft: `3px solid ${catInfo.color}` }}>
              <strong>{i + 1}. {s}</strong>
              <small>Kern已调度专业Agent · {catInfo.name}专用 · 预计今日可完成</small>
              <button style={{ background: catInfo.color, color: "white" }} onClick={() => onAction?.(s)}>去执行</button>
            </div>
          ))}
        </div>
      </div>

      <div className="quick-actions">
        <button className="primary" style={{ background: catInfo.color }} onClick={() => onAction?.("evidence")}>🔬 去补证据 · {data.gaps}个缺口</button>
        <button className="outline" onClick={() => onAction?.("cost")}>💰 成本计算器</button>
        <button className="outline" onClick={() => onAction?.("compliance")}>📦 合规检查</button>
        <button className="outline" onClick={() => onAction?.("timeline")}>📅 时间线</button>
      </div>
    </div>
  );
}
