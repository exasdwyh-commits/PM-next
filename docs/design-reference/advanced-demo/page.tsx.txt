"use client";

import * as React from "react";
import { RoleProvider } from "@/components/role-context";
import "@/components/design-tokens.css";
import "@/components/design-tokens-advanced.css";
import "@/components/beautified-overrides.css";
import "@/components/glass-card.css";
import "@/components/custom-chart.css";
import "@/components/dark-mode-toggle.css";
import { GlassCard, BentoGrid, BentoItem, GradientText, AnimatedCounter, MeshGradientBg } from "@/components/glass-card";
import { CustomDonut, CustomBarRace, CustomWaterfall, CustomRadar } from "@/components/custom-chart";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { DailyBriefingRich } from "@/components/daily-briefing-rich";
import { ProductRndCockpitRich } from "@/components/product-rnd-cockpit-rich";
import { MarketingLandingRich } from "@/components/marketing-landing-rich";

export default function DemoBeautifiedAdvancedPage() {
  const [category, setCategory] = React.useState("health_food");

  const mockDaily = {
    todos: 3, decisions: 2, gaps: 4, risks: 1, evidenceRate: 70, workRate: 62,
    verifiedCount: 7, totalEvidence: 10, doneWork: 5, totalWork: 8,
    category, projectTitle: "多酚软糖项目",
    suggestions: ["补充80℃烘焙温度证据", "优化成本到8元以内", "准备蓝帽子认证材料", "生成多酚功效销售话术"],
    generatedAt: new Date().toISOString(),
  };

  const barData = [
    { label: "原料", value: 8.05 },
    { label: "制造", value: 1.8 },
    { label: "包装", value: 2.4 },
    { label: "物流", value: 4.2 },
    { label: "合规", value: 2.5 },
  ];

  const waterfallData = [
    { label: "原料", value: 8.05, type: "cost" as const },
    { label: "制造", value: 1.8, type: "cost" as const },
    { label: "包装", value: 2.4, type: "cost" as const },
    { label: "物流", value: 4.2, type: "cost" as const },
    { label: "零售", value: 199, type: "profit" as const },
  ];

  const radarData = [
    { label: "性价比", value: 85 },
    { label: "功效", value: 90 },
    { label: "合规", value: 95 },
    { label: "口感", value: 80 },
    { label: "利润", value: 88 },
  ];

  return (
    <RoleProvider>
      <div style={{ padding: 16, display: "grid", gap: 20, maxWidth: 1400, margin: "0 auto", background: "var(--color-bg-muted, #f6f7f9)", minHeight: "100vh" }}>
        {/* Header - Glass + Mesh Gradient */}
        <MeshGradientBg category={category}>
          <GlassCard category={category} hover3d magnetic className="bento-item span-4" style={{ padding: 24 } as any}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                  <GradientText category={category}>✨ 全面美化 · 档3重度 · Linear/Notion级</GradientText>
                </h1>
                <p style={{ margin: 0, fontSize: 12, color: "#4b5563", lineHeight: 1.6, maxWidth: 600 }}>
                  OKLCH色彩 + Mesh Gradient + Glassmorphism backdrop-blur + Bento Dashboard + 渐变文字 + 磁性按钮 + 3D卡片 + CountUp + 自定义图表渐变+阴影+动画 + Dark Mode + Spring动效 + 视差 + 骨架屏精致
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {[
                    { id: "regular_food", label: "🍪普通食品", color: "#f59e0b" },
                    { id: "health_food", label: "💊保健食品", color: "#7c3aed" },
                    { id: "cross_border_food", label: "🌍跨境食品", color: "#0891b2" },
                    { id: "cosmetics", label: "💄化妆品", color: "#db2777" },
                  ].map(c => (
                    <button key={c.id} onClick={() => setCategory(c.id)} style={{ padding: "8px 14px", borderRadius: 999, border: category === c.id ? `2px solid ${c.color}` : "1px solid #e7e9ef", background: category === c.id ? c.color : "white", color: category === c.id ? "white" : c.color, fontWeight: 700, fontSize: 11, boxShadow: category === c.id ? `0 8px 24px ${c.color}30` : "0 1px 2px rgba(0,0,0,0.04)", transform: category === c.id ? "scale(1.05)" : "scale(1)", transition: "all 250ms cubic-bezier(0.34,1.56,0.64,1)" }}>{c.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, alignItems: "center" }}>
                <DarkModeToggle />
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ padding: "8px 12px", borderRadius: 12, background: "white", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", fontSize: 11, fontWeight: 700 }}><AnimatedCounter value={70} suffix="%" /> 可信</div>
                  <div style={{ padding: "8px 12px", borderRadius: 12, background: "white", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", fontSize: 11, fontWeight: 700 }}><AnimatedCounter value={62} suffix="%" /> 完成</div>
                </div>
              </div>
            </div>
          </GlassCard>
        </MeshGradientBg>

        {/* Bento Dashboard */}
        <BentoGrid>
          <BentoItem span={2} category={category}>
            <GlassCard category={category} hover3d style={{ height: "100%" } as any}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>📊 证据可信度 · 自定义Donut · 渐变+阴影+动画</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <CustomDonut value={7} total={10} category={category} size={120} label="已核实" />
                <div style={{ display: "grid", gap: 8 }}>
                  <div><strong><AnimatedCounter value={7} />/10</strong> 已核实 · <AnimatedCounter value={70} suffix="%" />可信</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["蓝帽子认证","多酚功效","软糖剂型"].map(s => <span key={s} style={{ padding: "3px 8px", borderRadius: 999, background: `${category === "health_food" ? "#7c3aed" : "#f59e0b"}15`, color: category === "health_food" ? "#7c3aed" : "#f59e0b", fontSize: 10, fontWeight: 600 }}>{s}</span>)}
                  </div>
                </div>
              </div>
            </GlassCard>
          </BentoItem>

          <BentoItem span={2} category={category}>
            <GlassCard category={category} hover3d style={{ height: "100%" } as any}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>💰 成本分布 · Bar Race · 渐变+shimmer+spring</h3>
              <CustomBarRace data={barData} category={category} />
            </GlassCard>
          </BentoItem>

          <BentoItem span={2} rowSpan={2} category={category}>
            <GlassCard category={category} hover3d style={{ height: "100%" } as any}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>📈 成本瀑布 · Waterfall · 利润可视化</h3>
              <CustomWaterfall data={waterfallData} category={category} />
            </GlassCard>
          </BentoItem>

          <BentoItem span={2} category={category}>
            <GlassCard category={category} hover3d style={{ height: "100%" } as any}>
              <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>🎯 综合评分 · Radar · 5维雷达</h3>
              <CustomRadar data={radarData} category={category} />
            </GlassCard>
          </BentoItem>

          <BentoItem span={4} category={category}>
            <GlassCard category={category} style={{ padding: 0, overflow: "hidden" } as any}>
              <DailyBriefingRich data={mockDaily} onAction={() => {}} />
            </GlassCard>
          </BentoItem>

          <BentoItem span={4} category={category}>
            <GlassCard category={category} style={{ padding: 0, overflow: "hidden" } as any}>
              <ProductRndCockpitRich project={{ title: mockDaily.projectTitle }} category={category} />
            </GlassCard>
          </BentoItem>

          <BentoItem span={4} category={category}>
            <GlassCard category={category} style={{ padding: 0, overflow: "hidden" } as any}>
              <MarketingLandingRich category={category} productName={mockDaily.projectTitle.replace("项目","")} />
            </GlassCard>
          </BentoItem>
        </BentoGrid>

        <GlassCard category={category} style={{ display: "grid", gap: 12 } as any}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>🎨 美化清单 · 档3重度 · Linear/Notion级</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 11 }}>
            <div><strong>色彩:</strong> OKLCH + Mesh Gradient radial+linear + 彩色阴影 + 渐变文字 background-clip</div>
            <div><strong>质感:</strong> Glassmorphism backdrop-blur 12px + bg white/80 + border gradient + 3D perspective rotateX/Y + 磁性按钮 scale</div>
            <div><strong>布局:</strong> Bento Grid 4列 + span-2/3/4 + row-2 + masonry + 响应式 1024px 2列 + 640px 1列</div>
            <div><strong>动效:</strong> Spring cubic-bezier(0.34,1.56,0.64,1) + stagger idx*80ms + countUp IntersectionObserver + shimmer + parallax</div>
            <div><strong>图表:</strong> 自定义Donut渐变+阴影+动画 + Bar Race shimmer + Waterfall利润 + Radar 5维 + tooltip精致</div>
            <div><strong>其他:</strong> Dark Mode prefers-color-scheme + data-theme + toggle + skeleton shimmer + focus ring + scrollbar 6px + typography层次</div>
          </div>
          <small style={{ fontSize: 10, color: "#9099a6" }}>💡 全面美化一步到位，从"能用"到"精致"到"惊艳"，达到 Linear/Notion 级，4类沉浸感 + 角色自适应 + 3D+磁性+视差+渐变+阴影+动效，日常使用愉悦，客户演示惊艳</small>
        </GlassCard>
      </div>
    </RoleProvider>
  );
}
