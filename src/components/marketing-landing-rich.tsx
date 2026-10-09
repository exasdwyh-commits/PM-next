"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { categoryMeta, categoryContent } from "@/modules/tenant";
import "./marketing-landing-rich.css";

export function MarketingLandingRich({ category = "health_food", productName = "多酚软糖", onExport }: any) {
  const { role } = useRole();
  const catInfo = categoryMeta(category);
  const content = categoryContent(category);
  // 本组件用完整卖点集（4 条），不做截取；cost 走 costSummary（数值，参与利润计算）。
  const [activeTab, setActiveTab] = React.useState("ppt");
  const [generating, setGenerating] = React.useState(false);
  const [generated, setGenerated] = React.useState(false);

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 1500);
  };

  return (
    <div className="marketing-landing-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="landing-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>💼 营销落地 · {catInfo.icon} {catInfo.name} · 一键生成 · 富可视化 · 15组件+8动效</span>
          <h2>{productName} · {catInfo.name} · 销售材料 · 给大客户</h2>
          <small>成本¥{content.costSummary} · 竞品¥{content.price} · 利润{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}% · {content.compliance.summary} · {content.selling.join(" · ")} · Kern已提炼</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>

      <div className="landing-tabs">
        <button className={activeTab === "ppt" ? "is-active" : ""} onClick={() => setActiveTab("ppt")}>📽️ 销售PPT</button>
        <button className={activeTab === "script" ? "is-active" : ""} onClick={() => setActiveTab("script")}>📝 话术</button>
        <button className={activeTab === "battlecard" ? "is-active" : ""} onClick={() => setActiveTab("battlecard")}>⚔️ Battlecard</button>
        <button className={activeTab === "quote" ? "is-active" : ""} onClick={() => setActiveTab("quote")}>💰 报价单</button>
        <button className={activeTab === "market" ? "is-active" : ""} onClick={() => setActiveTab("market")}>📊 市场图</button>
        <button className={activeTab === "compliance" ? "is-active" : ""} onClick={() => setActiveTab("compliance")}>✅ 合规清单</button>
      </div>

      {!generated ? (
        <div className="generate-prompt">
          <h3>🚀 一键生成销售材料 · {catInfo.icon} {catInfo.name} · 4类专用 · Kern调度</h3>
          <p>Kern将调度 marketing_agent + scientific_evidence_agent + compliance_agent + cost_bom_agent，生成销售PPT(15组件+8动效)+话术3版本+Battlecard+报价单+市场图+合规清单，{catInfo.name}专用，4类差异化</p>
          <div className="generate-chips">
            {content.selling.map(s => <span key={s} style={{ background: `${catInfo.color}15`, color: catInfo.color }}>{s}</span>)}
          </div>
          <button className="primary" style={{ background: catInfo.color }} onClick={handleGenerate} disabled={generating}>{generating ? "生成中... 15组件+8动效" : `📽️ 一键生成 ${productName} 销售材料 · ${catInfo.name}专用`}</button>
          <small>预计15秒生成 · 包含PPT+话术+Battlecard+报价单+市场图+合规清单 · 一键导出PDF/Word/HTML · {catInfo.name}专用</small>
        </div>
      ) : (
        <>
          {activeTab === "ppt" && (
            <div className="ppt-preview">
              <h4>📽️ 销售PPT · {productName} · {catInfo.icon} {catInfo.name} · 富可视化 · 15组件+8动效</h4>
              <div className="ppt-slides">
                <div className="slide" style={{ animationDelay: "0ms", borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>Slide 1: 封面 · {productName} · {catInfo.name}</strong>
                  <div className="kpi-row"><div className="kpi"><strong>¥{content.costSummary}</strong><small>成本</small></div><div className="kpi"><strong>¥{content.price}</strong><small>竞品</small></div><div className="kpi"><strong>{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%</strong><small>利润</small></div><div className="kpi"><strong>82%</strong><small>留存率</small></div></div>
                </div>
                <div className="slide" style={{ animationDelay: "100ms", borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>Slide 2: 核心卖点 · {content.selling.join(" · ")}</strong>
                  <div className="selling-grid">{content.selling.map((s, i) => <div key={i} className="selling-card" style={{ animationDelay: `${i * 80}ms` }}><span className="icon">{catInfo.icon}</span><strong>{s}</strong><small>客户价值：{s}符合趋势</small></div>)}</div>
                </div>
                <div className="slide" style={{ animationDelay: "200ms", borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>Slide 3: 证据+合规 · {content.compliance.summary}</strong>
                  <div className="evidence-grid"><div className="evidence-card"><strong>多酚留存82%</strong><small>lab_test · A级</small><span className="lvl A">A</span></div><div className="evidence-card"><strong>80℃烘焙工艺</strong><small>process_engineer · A级</small><span className="lvl A">A</span></div><div className="evidence-card"><strong>{content.compliance.summary}</strong><small>compliance_agent · 已合规</small><span className="lvl A">A</span></div></div>
                </div>
                <div className="slide" style={{ animationDelay: "300ms", borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>Slide 4: 成本+利润 · 4类专用</strong>
                  <div className="chart"><div className="bar"><span>成本</span><div className="track"><div className="fill" style={{ width: "30%", background: catInfo.color }}></div></div><strong>¥{content.costSummary}</strong></div><div className="bar"><span>竞品</span><div className="track"><div className="fill" style={{ width: "90%", background: "#f59e0b" }}></div></div><strong>¥{content.price}</strong></div><div className="bar"><span>利润</span><div className="track"><div className="fill" style={{ width: `${Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%`, background: "#0b7a4f" }}></div></div><strong>{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%</strong></div></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "script" && (
            <div className="script-preview">
              <h4>📝 销售话术 · {productName} · {catInfo.icon} {catInfo.name} · 3版本 · 一键复制</h4>
              <div className="script-grid">
                <div className="script-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>版本1: 专业版 · 给技术型客户</strong>
                  <p>&quot;{productName}经过{content.compliance.summary}，{content.selling[0]}，{content.selling[1]}，多酚留存82%已验证，80℃烘焙工艺，{content.selling[2]}，成本¥{content.costSummary}，竞品¥{content.price}，利润空间大，符合{catInfo.name}健康趋势。&quot;</p>
                  <small>📎 依据：lab_test A级 + {content.compliance.summary} · 适合：技术/研发型客户</small>
                  <button style={{ background: catInfo.color, color: "white" }}>📋 复制专业版</button>
                </div>
                <div className="script-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>版本2: 简洁版 · 给决策型客户</strong>
                  <p>&quot;{productName}，{content.selling[0]}，{content.selling[1]}，成本¥{content.costSummary}竞品¥{content.price}，利润{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%，{content.compliance.summary}已合规，建议首批1000盒试销。&quot;</p>
                  <small>📎 依据：cost_bom_agent + {content.compliance.summary} · 适合：老板/决策型客户</small>
                  <button style={{ background: catInfo.color, color: "white" }}>📋 复制简洁版</button>
                </div>
                <div className="script-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
                  <strong>版本3: 促单版 · 给价格敏感客户</strong>
                  <p>&quot;{productName}现在成本仅¥{content.costSummary}，竞品均价¥{content.price}，利润{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%，{content.selling[0]}，{content.selling[1]}，{content.compliance.summary}已合规，今天下单可享首批优惠，供货价¥{(parseFloat(content.costSummary) * 1.5).toFixed(1)}。&quot;</p>
                  <small>📎 依据：supplier_quote + cost_bom · 适合：价格敏感/促单</small>
                  <button style={{ background: catInfo.color, color: "white" }}>📋 复制促单版</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "battlecard" && (
            <div className="battlecard-preview">
              <h4>⚔️ Battlecard · {productName} vs 竞品 · {catInfo.icon} {catInfo.name} · 4类专用</h4>
              <table className="battle-table">
                <thead><tr><th>维度</th><th>{productName} · {catInfo.name}</th><th>竞品A</th><th>竞品B</th><th>优势</th></tr></thead>
                <tbody>
                  <tr><td>成本</td><td><strong>¥{content.costSummary}</strong></td><td>¥{content.price}</td><td>¥{(parseFloat(content.price) * 0.8).toFixed(0)}</td><td><span className="adv" style={{ background: `${catInfo.color}15`, color: catInfo.color }}>成本低{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%</span></td></tr>
                  <tr><td>卖点</td><td><strong>{content.selling[0]}</strong></td><td>普通</td><td>一般</td><td><span className="adv" style={{ background: `${catInfo.color}15`, color: catInfo.color }}>{content.selling[0]}突出</span></td></tr>
                  <tr><td>合规</td><td><strong>{content.compliance.summary}</strong></td><td>部分</td><td>无</td><td><span className="adv" style={{ background: `${catInfo.color}15`, color: catInfo.color }}>合规完整</span></td></tr>
                  <tr><td>留存率</td><td><strong>82%</strong></td><td>65%</td><td>70%</td><td><span className="adv" style={{ background: `${catInfo.color}15`, color: catInfo.color }}>留存高</span></td></tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "quote" && (
            <div className="quote-preview">
              <h4>💰 报价单 · {productName} · {catInfo.icon} {catInfo.name} · 4类专用</h4>
              <div className="quote-card" style={{ borderColor: catInfo.color }}>
                <div className="quote-header" style={{ background: catInfo.gradient }}><strong>{productName} · {catInfo.name} · 报价单</strong><small>{content.compliance.summary} · {content.selling.join(" · ")}</small></div>
                <div className="quote-body">
                  <div className="quote-row"><span>原料成本</span><strong>¥{(parseFloat(content.costSummary) * 0.6).toFixed(2)}</strong></div>
                  <div className="quote-row"><span>制造+包装</span><strong>¥{(parseFloat(content.costSummary) * 0.3).toFixed(2)}</strong></div>
                  <div className="quote-row"><span>物流+合规</span><strong>¥{(parseFloat(content.costSummary) * 0.1).toFixed(2)}</strong></div>
                  <div className="quote-row total" style={{ borderTop: `2px solid ${catInfo.color}` }}><span>总成本</span><strong>¥{content.costSummary}</strong></div>
                  <div className="quote-row"><span>建议供货价</span><strong>¥{(parseFloat(content.costSummary) * 1.5).toFixed(2)}</strong></div>
                  <div className="quote-row"><span>建议零售价</span><strong>¥{content.price}</strong></div>
                  <div className="quote-row profit" style={{ background: `${catInfo.color}08` }}><span>利润率</span><strong>{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}% · 利润¥{(parseFloat(content.price) - parseFloat(content.costSummary)).toFixed(2)}</strong></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "market" && (
            <div className="market-preview">
              <h4>📊 市场增长图 · {catInfo.icon} {catInfo.name} · 4类专用</h4>
              <div className="market-chart">
                <div className="bar"><span>2022</span><div className="track"><div className="fill" style={{ width: "40%", background: "#e7e9ef" }}></div></div><small>100亿</small></div>
                <div className="bar"><span>2023</span><div className="track"><div className="fill" style={{ width: "60%", background: catInfo.color, opacity: 0.6 }}></div></div><small>150亿 +50%</small></div>
                <div className="bar"><span>2024</span><div className="track"><div className="fill" style={{ width: "80%", background: catInfo.color }}></div></div><small>200亿 +33% · {catInfo.name}趋势</small></div>
                <div className="bar"><span>2025预测</span><div className="track"><div className="fill" style={{ width: "100%", background: catInfo.color }}></div></div><strong>260亿 +30% · 健康趋势</strong></div>
              </div>
              <small>💡 {catInfo.name}市场23%增长，{content.selling[0]}符合健康趋势，建议快速上市</small>
            </div>
          )}

          {activeTab === "compliance" && (
            <div className="compliance-preview">
              <h4>✅ 合规可宣称清单 · {catInfo.icon} {catInfo.name} · {content.compliance.summary}</h4>
              <div className="compliance-list">
                <div className="compliance-item ok" style={{ borderLeft: `3px solid #0b7a4f` }}><strong>✅ {content.compliance.summary}</strong><small>已合规 · 可宣称 · {catInfo.name}专用</small><span className="lvl A">A级</span></div>
                <div className="compliance-item ok" style={{ borderLeft: `3px solid #0b7a4f` }}><strong>✅ 多酚功效可宣称</strong><small>多酚留存82%已验证 · lab_test A级 · 可宣称&quot;富含多酚&quot;</small><span className="lvl A">A级</span></div>
                <div className="compliance-item warn" style={{ borderLeft: `3px solid #f59e0b` }}><strong>⚠️ 功能声称需注意</strong><small>不能宣称&quot;治疗&quot;，可宣称&quot;有助于&quot; · {catInfo.name}专用边界</small><span className="lvl B">B级</span></div>
                <div className="compliance-item"><strong>📋 标签合规</strong><small>配料表+营养成分表+保质期+贮存条件已核实 · {content.compliance.summary}</small><span className="lvl A">A级</span></div>
              </div>
            </div>
          )}

          <div className="export-actions">
            <button className="primary" style={{ background: catInfo.color }} onClick={() => onExport?.("pdf")}>📄 导出PDF · {catInfo.name}专用</button>
            <button className="outline" onClick={() => onExport?.("docx")}>📝 导出Word</button>
            <button className="outline" onClick={() => onExport?.("html")}>🌐 导出HTML</button>
            <small>💡 一键导出 · 包含PPT+话术+Battlecard+报价单+市场图+合规清单 · {catInfo.name}专用 · 富可视化15组件+8动效</small>
          </div>
        </>
      )}

      <div className="quick-sales">
        <h4>⚡ 客户现场快问快答 · {catInfo.icon} {catInfo.name} · 3秒返回 · 复制即用</h4>
        <div className="qa-grid">
          <div className="qa-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}><strong>Q: 卖点是什么？</strong><p>A: {content.selling[0]}，{content.selling[1]}，{content.selling[2]}，成本¥{content.costSummary}竞品¥{content.price}利润{Math.round((1 - parseFloat(content.costSummary) / parseFloat(content.price)) * 100)}%</p><button style={{ background: catInfo.color, color: "white" }}>📋 复制</button></div>
          <div className="qa-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}><strong>Q: 为什么值{content.price}？</strong><p>A: {content.compliance.summary}已合规，多酚留存82%验证，{content.selling[0]}，{content.selling[1]}，竞品均价{content.price}，利润空间大</p><button style={{ background: catInfo.color, color: "white" }}>📋 复制</button></div>
          <div className="qa-card" style={{ borderLeft: `3px solid ${catInfo.color}` }}><strong>Q: 合规吗？</strong><p>A: {content.compliance.summary}已合规，可宣称&quot;{content.selling[0]}&quot;，标签已核实，A级证据，可放心销售</p><button style={{ background: catInfo.color, color: "white" }}>📋 复制</button></div>
        </div>
      </div>
    </div>
  );
}
