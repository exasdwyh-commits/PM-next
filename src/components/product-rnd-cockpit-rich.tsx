"use client";

import * as React from "react";
import { useRole } from "./role-context";
import "./product-rnd-cockpit-rich.css";
import { DailyBriefingRich } from "./daily-briefing-rich";
import { ProductRndPanelRich } from "./product-rnd-panel-rich";
import "./product-rnd-panel-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string; formula: string; cost: string; compliance: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)", formula: "面粉+糖+油 基础配方", cost: "原料0.98+加工1.2+包装1.1+物流4.1+渠道35% 零售39.9", compliance: "SC合规" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)", formula: "多酚+低聚果糖+软糖基质", cost: "原料8.05+配方0.8+软糖1.5+制造1.8+检测1.2+合规2.5+包装2.4+物流4.2+渠道42% 零售199", compliance: "蓝帽子认证" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)", formula: "进口多酚+跨境基质", cost: "进口原料12+国际物流3.5+关税12%+报关1.2+清关0.8+合规1.5+包装2+物流5.5+渠道45% 零售129", compliance: "进口资质+跨境标签" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)", formula: "透明质酸+烟酰胺+精华基质", cost: "原料15+配方1.2+制造2.5+灌装1.0+包装8+2+1+5玻璃瓶+检测1.5+安全1+功效1+合规3+物流5+易碎0.5+渠道58% 零售299", compliance: "备案+功效宣称" },
};

export function ProductRndCockpitRich({ project, category = "health_food", onOptimize }: any) {
  const { role } = useRole();
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const [activeTab, setActiveTab] = React.useState("overview");
  const [optimizing, setOptimizing] = React.useState(false);
  const [schemes, setSchemes] = React.useState<any[]>([]);

  const handleOptimize = async () => {
    setOptimizing(true);
    // Simulate 3 schemes
    setTimeout(() => {
      setSchemes([
        { name: "方案A 成本最优", cost: 7.8, margin: "68%", risk: "低", desc: "替换供应商B，原料降20%，多酚留存80%" },
        { name: "方案B 功效最优", cost: 9.2, margin: "62%", risk: "中", desc: "保持配方，优化工艺，留存85%" },
        { name: "方案C 平衡", cost: 8.5, margin: "65%", risk: "低", desc: "部分替换+工艺优化，留存82%" },
      ]);
      setOptimizing(false);
      onOptimize?.();
    }, 1500);
  };

  return (
    <div className="product-rnd-cockpit-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="cockpit-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name} · 产品研发驾驶舱 · {role}视角 · 一页看懂 · Kern统筹</span>
          <h2>{project?.title || "多酚软糖项目"} · {catInfo.formula} · {catInfo.compliance}</h2>
          <small>{catInfo.cost} · {catInfo.name}专用 · 配方+成本+合规+供应商+证据+风险+决策 全部一页 · Kern自动填充</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>

      <div className="cockpit-tabs">
        <button className={activeTab === "overview" ? "is-active" : ""} style={{ borderColor: activeTab === "overview" ? catInfo.color : undefined } as any} onClick={() => setActiveTab("overview")}>📊 总览</button>
        <button className={activeTab === "formula" ? "is-active" : ""} onClick={() => setActiveTab("formula")}>🧪 配方</button>
        <button className={activeTab === "cost" ? "is-active" : ""} onClick={() => setActiveTab("cost")}>💰 成本</button>
        <button className={activeTab === "compliance" ? "is-active" : ""} onClick={() => setActiveTab("compliance")}>📦 合规</button>
        <button className={activeTab === "supplier" ? "is-active" : ""} onClick={() => setActiveTab("supplier")}>🏭 供应商</button>
        <button className={activeTab === "evidence" ? "is-active" : ""} onClick={() => setActiveTab("evidence")}>🔬 证据</button>
        <button className={activeTab === "timeline" ? "is-active" : ""} onClick={() => setActiveTab("timeline")}>📅 时间线</button>
      </div>

      {activeTab === "overview" && (
        <div className="cockpit-overview">
          <div className="kpi-grid">
            <div className="kpi ok" style={{ animationDelay: "0ms" }}><span>✅ 配方完成度</span><strong>85%</strong><small>{catInfo.formula.slice(0, 20)}</small><div className="kpi-bar"><div className="fill" style={{ width: "85%", background: catInfo.color }}></div></div></div>
            <div className="kpi brand" style={{ animationDelay: "80ms" }}><span>💰 成本</span><strong>¥10.2</strong><small>目标¥8.0 · 需优化</small><div className="kpi-bar"><div className="fill" style={{ width: "70%", background: "#f59e0b" }}></div></div></div>
            <div className="kpi warn" style={{ animationDelay: "160ms" }}><span>📦 合规</span><strong>{catInfo.compliance}</strong><small>已检查 · {catInfo.name}专用</small></div>
            <div className="kpi bad" style={{ animationDelay: "240ms" }}><span>⚠️ 风险</span><strong>1</strong><small>成本偏高需优化</small></div>
          </div>

          <div className="cockpit-sections">
            <div className="section" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
              <h4>🧪 配方 · {catInfo.name} · {catInfo.formula}</h4>
              <p>当前配方: {catInfo.formula}，多酚留存82%已验证，80℃烘焙工艺，软糖剂型，{catInfo.compliance}已合规</p>
              <div className="chips"><span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>多酚留存82%</span><span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>80℃烘焙</span><span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>软糖剂型</span></div>
            </div>
            <div className="section" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
              <h4>💰 成本 · {catInfo.cost}</h4>
              <p>当前总成本¥10.2，目标¥8.0，需优化¥2.2，Kern已调度 cost_bom_agent + supplier_agent + formulation_agent</p>
              <button className="primary" style={{ background: catInfo.color }} onClick={handleOptimize} disabled={optimizing}>{optimizing ? "优化中..." : "🚀 一键优化到8元以内 · 3方案对比"}</button>
            </div>
            <div className="section" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
              <h4>📦 合规 · {catInfo.compliance} · {catInfo.name}专用</h4>
              <p>{catInfo.compliance}已检查，{catInfo.name}专用合规，宣称边界已核实，可宣称&quot;多酚功效&quot;</p>
            </div>
            <div className="section" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
              <h4>🏭 供应商 · 3家对比 · {catInfo.name}</h4>
              <p>供应商A 10.2元 + 供应商B 8.5元 + 供应商C 9.0元，B最优，Kern已调度 supply_ops_agent</p>
            </div>
          </div>

          {schemes.length > 0 && (
            <div className="schemes">
              <h4>💡 成本优化3方案对比 · {catInfo.icon} {catInfo.name} · Kern生成 · 富可视化</h4>
              <div className="scheme-grid">
                {schemes.map((s, idx) => (
                  <div key={idx} className="scheme-card" style={{ animationDelay: `${idx * 100}ms`, borderColor: idx === 0 ? catInfo.color : "#e7e9ef", background: idx === 0 ? `${catInfo.color}08` : "white" }}>
                    <div className="scheme-header"><strong>{s.name}</strong>{idx === 0 && <span className="badge" style={{ background: catInfo.color, color: "white" }}>推荐</span>}</div>
                    <div className="scheme-kpi"><span>成本</span><strong>¥{s.cost}</strong><span>利润 {s.margin}</span><span>风险 {s.risk}</span></div>
                    <small>{s.desc} · {catInfo.name}专用</small>
                    <div className="scheme-bar"><div className="track"><div className="fill" style={{ width: `${100 - s.cost * 5}%`, background: catInfo.color }}></div></div><small>成本优化度 {100 - s.cost * 5}%</small></div>
                    <button style={{ background: catInfo.color, color: "white" }}>选择此方案 · 保存v{idx + 2}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="timeline">
            <h4>📅 时间线 · 甘特图 · 关键路径 · {catInfo.name}</h4>
            <div className="timeline-grid">
              <div className="timeline-item done" style={{ borderLeft: `3px solid ${catInfo.color}` }}><div className="dot" style={{ background: catInfo.color }}></div><div><strong>配方确定</strong><small>已完成 · 2024-10-01 · 多酚+低聚果糖+软糖基质</small></div><span className="status done">已完成</span></div>
              <div className="timeline-item running" style={{ borderLeft: `3px solid #f59e0b` }}><div className="dot" style={{ background: "#f59e0b" }}></div><div><strong>成本优化</strong><small>进行中 · 目标8元 · Kern调度中 · 预计今日完成</small></div><span className="status running">进行中</span></div>
              <div className="timeline-item queued"><div className="dot"></div><div><strong>合规检查</strong><small>待开始 · {catInfo.compliance} · 依赖成本优化</small></div><span className="status queued">待开始</span></div>
              <div className="timeline-item queued"><div className="dot"></div><div><strong>供应商打样</strong><small>待开始 · 3家供应商 · 依赖合规</small></div><span className="status queued">待开始</span></div>
              <div className="timeline-item queued"><div className="dot"></div><div><strong>测试+上市</strong><small>待开始 · 预计2024-11-15上市 · {catInfo.name}专用</small></div><span className="status queued">待开始</span></div>
            </div>
            <div className="critical-path" style={{ borderColor: catInfo.color }}><strong>关键路径:</strong> 配方确定 → 成本优化 → 合规检查 → 供应商打样 → 测试+上市 · 总计45天 · 当前进度62% · {catInfo.name}专用</div>
          </div>
        </div>
      )}

      {activeTab !== "overview" && (
        <div className="cockpit-placeholder">
          <p>{activeTab} 模块 · {catInfo.icon} {catInfo.name} · {role}视角 · 富可视化 · Kern调度 · 点击总览查看完整驾驶舱</p>
          <button onClick={() => setActiveTab("overview")}>返回总览</button>
        </div>
      )}
    </div>
  );
}
