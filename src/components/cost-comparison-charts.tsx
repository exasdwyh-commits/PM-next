"use client";

import * as React from "react";
import type { CostScenario } from "@/modules/cost-engine/scenario";
import { categoryMeta } from "@/modules/tenant";
import "./cost-comparison-charts.css";

export function CostComparisonCharts({
  scenarios,
  comparison,
}: {
  scenarios: CostScenario[];
  comparison: Record<string, { min: number; max: number; avg: number; values?: number[] }>;
}) {
  const [activeChart, setActiveChart] = React.useState<"bar" | "pie" | "waterfall">("bar");

  if (scenarios.length < 2) {
    return <div className="comparison-charts empty">至少需要2个方案才能对比图表</div>;
  }

  const metrics = [
    { key: "totalMaterialCost", label: "原料", color: "#7c3aed" },
    { key: "totalManufacturingCost", label: "生产", color: "#06b6d4" },
    { key: "totalPackagingCost", label: "包装", color: "#8b5cf6" },
    { key: "totalLogisticsCost", label: "物流", color: "#f59e0b" },
    { key: "totalComplianceCost", label: "合规", color: "#ef4444" },
    { key: "totalChannelCost", label: "渠道", color: "#10b981" },
    { key: "totalCost", label: "总成本", color: "#0f1116" },
  ];

  const maxTotal = Math.max(...scenarios.map(s => s.totalCost), 1);

  return (
    <div className="comparison-charts">
      <div className="charts-header">
        <strong>📊 对比图表 · 富可视化 · {scenarios.length}个方案</strong>
        <div className="chart-tabs">
          <button className={activeChart === "bar" ? "active" : ""} onClick={() => setActiveChart("bar")}>📊 柱状对比</button>
          <button className={activeChart === "pie" ? "active" : ""} onClick={() => setActiveChart("pie")}>🍩 占比</button>
          <button className={activeChart === "waterfall" ? "active" : ""} onClick={() => setActiveChart("waterfall")}>💧 瀑布</button>
        </div>
      </div>

      {activeChart === "bar" && (
        <div className="chart-panel bar-chart">
          <div className="bar-grid">
            {scenarios.map((scenario, idx) => (
              <div key={scenario.id} className="scenario-bar-group" style={{ animationDelay: `${idx * 100}ms` }}>
                <div className="scenario-label">
                  <strong>{scenario.name}</strong>
                  <small>{categoryMeta(scenario.category).icon}{categoryMeta(scenario.category).name.slice(0, 2)} · ¥{scenario.totalCost.toFixed(2)}</small>
                </div>
                <div className="bars">
                  {metrics.slice(0, 6).map(m => {
                    const value = (scenario as any)[m.key] as number;
                    const pct = (value / maxTotal * 100).toFixed(0);
                    return (
                      <div key={m.key} className="bar-row">
                        <span className="bar-label">{m.label}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${pct}%`, background: m.color, animationDelay: `${idx * 100 + 200}ms` }}>
                            <span>¥{value.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeChart === "pie" && (
        <div className="chart-panel pie-chart">
          <div className="pie-grid">
            {scenarios.slice(0, 3).map((scenario, idx) => {
              const total = scenario.totalCost;
              const items = [
                { label: "原料", value: scenario.totalMaterialCost, color: "#7c3aed" },
                { label: "生产", value: scenario.totalManufacturingCost, color: "#06b6d4" },
                { label: "包装", value: scenario.totalPackagingCost, color: "#8b5cf6" },
                { label: "物流", value: scenario.totalLogisticsCost, color: "#f59e0b" },
                { label: "合规", value: scenario.totalComplianceCost, color: "#ef4444" },
                { label: "渠道", value: scenario.totalChannelCost, color: "#10b981" },
              ];
              const max = Math.max(...items.map(i => i.value), 1);
              return (
                <div key={scenario.id} className="pie-card" style={{ animationDelay: `${idx * 150}ms` }}>
                  <strong>{scenario.name}</strong>
                  <small>总成本 ¥{total.toFixed(2)}</small>
                  <div className="pie-bars">
                    {items.map(item => (
                      <div key={item.label} className="pie-bar-row">
                        <span style={{ background: item.color }} className="dot"></span>
                        <span className="label">{item.label}</span>
                        <div className="track"><div className="fill" style={{ width: `${(item.value/max*100).toFixed(0)}%`, background: item.color }}></div></div>
                        <span className="value">¥{item.value.toFixed(2)}</span>
                        <span className="pct">{(item.value/total*100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeChart === "waterfall" && (
        <div className="chart-panel waterfall-chart">
          <div className="waterfall-grid">
            {scenarios.map((scenario, idx) => {
              let cumulative = 0;
              const items = [
                { label: "原料", value: scenario.totalMaterialCost, color: "#7c3aed" },
                { label: "生产", value: scenario.totalManufacturingCost, color: "#06b6d4" },
                { label: "包装", value: scenario.totalPackagingCost, color: "#8b5cf6" },
                { label: "物流", value: scenario.totalLogisticsCost, color: "#f59e0b" },
                { label: "合规", value: scenario.totalComplianceCost, color: "#ef4444" },
                { label: "渠道", value: scenario.totalChannelCost, color: "#10b981" },
              ].map(item => {
                const start = cumulative;
                cumulative += item.value;
                return { ...item, start, end: cumulative };
              });
              const max = Math.max(...items.map(i => i.end), 1);
              return (
                <div key={scenario.id} className="waterfall-card" style={{ animationDelay: `${idx * 150}ms` }}>
                  <strong>{scenario.name} · ¥{scenario.totalCost.toFixed(2)}</strong>
                  <div className="waterfall-bars">
                    {items.map((item, i) => (
                      <div key={item.label} className="wf-bar" style={{ animationDelay: `${idx * 150 + i * 50}ms` }}>
                        <small>{item.label}</small>
                        <div className="wf-track">
                          <div className="wf-fill" style={{ height: `${(item.value/max*100).toFixed(0)}%`, background: item.color }}>
                            <span>¥{item.value.toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="wf-bar total">
                      <small>总计</small>
                      <div className="wf-track"><div className="wf-fill" style={{ height: "100%", background: "#0f1116" }}><span>¥{scenario.totalCost.toFixed(1)}</span></div></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="comparison-summary">
        <div className="summary-row">
          <span>最低总成本</span><strong style={{ color: "#0b7a4f" }}>¥{comparison.totalCost?.min.toFixed(2)}</strong>
          <span>最高</span><strong style={{ color: "#b32b23" }}>¥{comparison.totalCost?.max.toFixed(2)}</strong>
          <span>均值</span><strong>¥{comparison.totalCost?.avg.toFixed(2)}</strong>
          <span>节省</span><strong>¥{(comparison.totalCost ? comparison.totalCost.max - comparison.totalCost.min : 0).toFixed(2)}</strong>
        </div>
      </div>
    </div>
  );
}
