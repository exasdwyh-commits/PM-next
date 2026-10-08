"use client";

import * as React from "react";
import { RoleProvider } from "@/components/role-context";
import { DailyBriefingRich } from "@/components/daily-briefing-rich";
import "@/components/daily-briefing-rich.css";
import { ProductRndCockpitRich } from "@/components/product-rnd-cockpit-rich";
import "@/components/product-rnd-cockpit-rich.css";
import { MarketingLandingRich } from "@/components/marketing-landing-rich";
import "@/components/marketing-landing-rich.css";

export default function DemoDailyAssistantPage() {
  const [active, setActive] = React.useState("daily");
  const [category, setCategory] = React.useState("health_food");

  const mockDailyData = {
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
    suggestions: category === "health_food" ? ["补充80℃烘焙温度证据", "优化成本到8元以内", "准备蓝帽子认证材料", "生成多酚功效销售话术"] : category === "cosmetics" ? ["补充化妆品备案", "优化玻璃瓶包材成本", "准备透明质酸卖点PPT", "核实烟酰胺美白证据"] : ["补充进口资质", "优化国际物流成本", "准备跨境背书材料", "核实保税仓发货流程"],
    generatedAt: new Date().toISOString(),
  };

  return (
    <RoleProvider>
      <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
        <h1>🏢 Kern 日常助理 + 产品研发 + 营销落地 · P4-P6 Demo · 富可视化</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setActive("daily")} style={{ padding: "8px 14px", borderRadius: 8, border: active === "daily" ? "2px solid #0f1116" : "1px solid #e7e9ef", background: active === "daily" ? "#0f1116" : "white", color: active === "daily" ? "white" : "black", fontWeight: 700 }}>📅 日常助理 Daily Briefing</button>
          <button onClick={() => setActive("product")} style={{ padding: "8px 14px", borderRadius: 8, border: active === "product" ? "2px solid #7c3aed" : "1px solid #e7e9ef", background: active === "product" ? "#7c3aed" : "white", color: active === "product" ? "white" : "black", fontWeight: 700 }}>🧪 产品研发驾驶舱</button>
          <button onClick={() => setActive("marketing")} style={{ padding: "8px 14px", borderRadius: 8, border: active === "marketing" ? "2px solid #db2777" : "1px solid #e7e9ef", background: active === "marketing" ? "#db2777" : "white", color: active === "marketing" ? "white" : "black", fontWeight: 700 }}>💼 营销落地</button>
          <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
            {[
              { id: "regular_food", label: "🍪普通" },
              { id: "health_food", label: "💊保健" },
              { id: "cross_border_food", label: "🌍跨境" },
              { id: "cosmetics", label: "💄化妆品" },
            ].map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)} style={{ padding: "6px 10px", borderRadius: 8, border: category === c.id ? "2px solid #0f1116" : "1px solid #e7e9ef", background: category === c.id ? "#f6f7f9" : "white", fontSize: 11 }}>{c.label}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: 12, background: "#f6f7f9", borderRadius: 8, fontSize: 11 }}>
          <strong>当前:</strong> {active} · {category} · 角色自适应 👔领导/🔬研发/💼销售 · 4类专用 · 富可视化18组件+8动效 · 3秒首屏 · Kern智能统筹
        </div>

        {active === "daily" && <DailyBriefingRich data={mockDailyData} onAction={(a) => console.log("action", a)} />}
        {active === "product" && <ProductRndCockpitRich project={{ title: mockDailyData.projectTitle }} category={category} onOptimize={() => console.log("optimize")} />}
        {active === "marketing" && <MarketingLandingRich category={category} productName={mockDailyData.projectTitle.replace("项目", "")} onExport={(f) => console.log("export", f)} />}
      </div>
    </RoleProvider>
  );
}
