"use client";

import * as React from "react";
import { RoleProvider } from "@/components/role-context";
import "@/components/design-tokens.css";
import "@/components/beautified-overrides.css";
import "@/components/daily-briefing-rich.css";
import "@/components/product-rnd-cockpit-rich.css";
import "@/components/marketing-landing-rich.css";
import "@/components/executive-report-rich.css";
import "@/components/product-rnd-panel-rich.css";
import { DailyBriefingRich } from "@/components/daily-briefing-rich";
import { ProductRndCockpitRich } from "@/components/product-rnd-cockpit-rich";
import { MarketingLandingRich } from "@/components/marketing-landing-rich";

export default function DemoBeautifiedPage() {
  const [category, setCategory] = React.useState("health_food");

  const mockData = {
    todos: 3,
    decisions: 2,
    gaps: 4,
    risks: 1,
    evidenceRate: 70,
    workRate: 62,
    verifiedCount: 7,
    totalEvidence: 10,
    doneWork: 5,
    totalWork: 8,
    category,
    projectTitle: category === "health_food" ? "多酚软糖项目" : category === "cosmetics" ? "透明质酸精华项目" : category === "cross_border_food" ? "进口多酚项目" : "低糖饼干项目",
    suggestions: ["补充80℃烘焙温度证据", "优化成本到8元以内", "准备蓝帽子认证材料", "生成多酚功效销售话术"],
    generatedAt: new Date().toISOString(),
  };

  return (
    <RoleProvider>
      <div style={{ padding: 16, display: "grid", gap: 24, maxWidth: 1200, margin: "0 auto", background: "var(--color-bg-muted, #f6f7f9)", minHeight: "100vh" }}>
        <div className="card-beautified" data-category={category} style={{ padding: 20, display: "grid", gap: 12 }}>
          <h1 style={{ margin: 0, font: "800 22px/1.2 var(--font-sans)", letterSpacing: "-0.02em" }}>✨ 前端 UI 美化提升 · 档1轻量美化 · 零风险 · 立即提升30%</h1>
          <p style={{ margin: 0, font: "400 12px/1.6 var(--font-sans)", color: "var(--color-ink-muted)" }}>
            设计令牌 --space/--radius/--shadow/--font/--color/--cat + 卡片阴影 shadow-sm→md + hover lift translateY -2px + 4类彩色阴影 + 按钮 gradient+shadow + 字体层次 eyebrow uppercase + 动效 spring + focus ring + scrollbar 美化
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { id: "regular_food", label: "🍪普通食品", color: "#f59e0b" },
              { id: "health_food", label: "💊保健食品", color: "#7c3aed" },
              { id: "cross_border_food", label: "🌍跨境食品", color: "#0891b2" },
              { id: "cosmetics", label: "💄化妆品", color: "#db2777" },
            ].map(c => (
              <button key={c.id} className="btn-beautified primary" data-category={c.id} onClick={() => setCategory(c.id)} style={{ background: category === c.id ? c.color : "white", color: category === c.id ? "white" : c.color, borderColor: c.color }}>{c.label}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div className="kpi-beautified" data-category={category}><span className="label">已核实证据</span><strong className="value">7/10</strong><small className="note">70%可信 · 4类专用</small></div>
            <div className="kpi-beautified"><span className="label">工作进度</span><strong className="value">5/8</strong><small className="note">62%完成</small></div>
            <div className="kpi-beautified"><span className="label">待决策</span><strong className="value">2</strong><small className="note">需拍板</small></div>
            <div className="kpi-beautified"><span className="label">缺口/风险</span><strong className="value">5</strong><small className="note">4缺口+1风险</small></div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <h2 className="title-beautified">📅 日常助理 · Daily Briefing · 美化后</h2>
          <DailyBriefingRich data={mockData} onAction={() => {}} />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <h2 className="title-beautified">🧪 产品研发驾驶舱 · 美化后 · 彩色阴影+hover lift</h2>
          <ProductRndCockpitRich project={{ title: mockData.projectTitle }} category={category} />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <h2 className="title-beautified">💼 营销落地 · 美化后 · 按钮gradient+shadow</h2>
          <MarketingLandingRich category={category} productName={mockData.projectTitle.replace("项目", "")} />
        </div>

        <div className="card-beautified" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h3 className="title-beautified">🎨 美化对比 · Before vs After</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div style={{ padding: 12, border: "1px dashed #e7e9ef", borderRadius: 12, background: "white" }}>
              <strong style={{ fontSize: 11 }}>Before: 扁平无阴影</strong>
              <div style={{ marginTop: 8, padding: 12, border: "1px solid #e7e9ef", borderRadius: 8, background: "white" }}>卡片无阴影，无hover，无彩色阴影，按钮无gradient</div>
            </div>
            <div className="card-beautified" data-category={category} style={{ padding: 12 }}>
              <strong style={{ fontSize: 11 }}>After: 层次+阴影+hover lift+彩色阴影</strong>
              <div className="card-beautified" data-category={category} style={{ marginTop: 8, padding: 12 }}>卡片 shadow-sm → hover shadow-md + translateY -2px + 彩色阴影 {category}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button className="btn-beautified primary" data-category={category}>Primary 按钮</button>
                <button className="btn-beautified">Outline 按钮</button>
              </div>
            </div>
          </div>
          <small className="body-beautified">💡 轻量美化零风险，不改逻辑，纯CSS提升，卡片有层次，hover有反馈，按钮有质感，色彩有阴影，字体有层次，整体从&quot;能用&quot;到&quot;精致&quot; · 4类专用更沉浸，角色自适应更明显</small>
        </div>
      </div>
    </RoleProvider>
  );
}
