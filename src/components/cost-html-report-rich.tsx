"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { costResultToRichEnvelope, generateRichHtmlReport, type RichHtmlReportInput } from "@/modules/cost-engine/html-report-rich";
import { validate } from "@/modules/response-format/validate";
import { ResponseView } from "@/app/muse/response/response-view";
import { KernArtifactPanel, type Artifact } from "./kern-artifact-panel";
import type { ModularCostResult } from "@/modules/cost-engine/modules/types";
import type { BomItem } from "@/modules/cost-engine/bom-import";
import type { SupplierQuote } from "@/modules/cost-engine/supplier-quote";
import type { ComplianceItem } from "@/modules/cost-engine/compliance-checklist";
import "./cost-html-report.css";
import "./kern-artifact-panel.css";

export function CostHtmlReportRich({
  category,
  productName,
  result,
  bomItems = [],
  supplierQuotes = [],
  complianceItems = [],
}: {
  category: string;
  productName: string;
  result: ModularCostResult | null;
  bomItems?: BomItem[];
  supplierQuotes?: SupplierQuote[];
  complianceItems?: ComplianceItem[];
}) {
  const { role } = useRole();
  const [viewMode, setViewMode] = React.useState<"artifact" | "envelope" | "split">("split");
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([]);
  const [currentArtifact, setCurrentArtifact] = React.useState<Artifact | null>(null);
  const [showAnimation, setShowAnimation] = React.useState(true);

  const input: RichHtmlReportInput | null = React.useMemo(() => {
    if (!result) return null;
    return {
      category,
      productName,
      result,
      bomItems,
      supplierQuotes,
      complianceItems,
      role: role as any,
    };
  }, [category, productName, result, bomItems, supplierQuotes, complianceItems, role]);

  const envelope = React.useMemo(() => {
    if (!input) return null;
    return costResultToRichEnvelope(input);
  }, [input]);

  const validation = React.useMemo(() => {
    if (!envelope) return null;
    return validate(envelope);
  }, [envelope]);

  React.useEffect(() => {
    if (input && envelope) {
      const html = generateRichHtmlReport(input);
      const artifact: Artifact = {
        id: `artifact-${Date.now()}`,
        title: `${input.productName} · 富可视化成本报告`,
        html,
        category: input.category,
        timestamp: new Date().toISOString(),
        role: input.role,
      };
      setCurrentArtifact(artifact);
      setArtifacts(prev => [artifact, ...prev].slice(0, 10));
    }
  }, [input, envelope]);

  const handleSelectArtifact = (id: string) => {
    const found = artifacts.find(a => a.id === id);
    if (found) setCurrentArtifact(found);
  };

  if (!result || !input || !envelope) {
    return <div className="cost-html-report empty">暂无成本数据，请先完成成本核算 · 富可视化15组件+8动效等待中</div>;
  }

  const isValid = validation ? validation.filter(v => v.level === "error").length === 0 : false;

  return (
    <div className="cost-html-report rich" data-role={role}>
      <div className="html-report-header">
        <div>
          <h4>🎨 Kern完美结合 · 富可视化Artifact · 15组件+8动效</h4>
          <small>
            {category === "regular_food" ? "🍪普通食品" : category === "health_food" ? "💊保健食品" : category === "cross_border_food" ? "🌍跨境食品" : "💄化妆品"} · {productName} · {role}视角 · 
            {isValid ? "✅ 通过harness R1-R17" : `❌ ${validation?.filter(v=>v.level==="error").length}个error`} · 
            {envelope.blocks.length}个Block · 动画{showAnimation ? "开启" : "关闭"} · Claude风格
          </small>
        </div>
        <div className="html-report-actions">
          <div className="view-tabs">
            <button className={viewMode === "split" ? "active" : ""} onClick={() => setViewMode("split")}>🔀 分栏·Kern结合</button>
            <button className={viewMode === "artifact" ? "active" : ""} onClick={() => setViewMode("artifact")}>🎨 Artifact</button>
            <button className={viewMode === "envelope" ? "active" : ""} onClick={() => setViewMode("envelope")}>📦 Envelope</button>
          </div>
          <div className="export-actions">
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <input type="checkbox" checked={showAnimation} onChange={e => setShowAnimation(e.target.checked)} /> 动效
            </label>
          </div>
        </div>
      </div>

      {validation && validation.length > 0 && (
        <div className="harness-panel">
          <strong>🔍 Harness校验 R1-R17 · {validation.length}条 · {isValid ? "✅ 全部通过" : "❌ 有error"}</strong>
          <div className="harness-issues">
            {validation.map((issue, i) => (
              <div key={i} className={`issue ${issue.level}`}>
                <span className="level">{issue.level}</span>
                <span className="id">{issue.id}</span>
                <span className="desc">{issue.desc}</span>
                <small>{issue.detail}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === "split" && (
        <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "16px", minHeight: "800px" }}>
          <div style={{ border: "1px solid #e7e9ef", borderRadius: "16px", overflow: "hidden", background: "white" }}>
            <div style={{ padding: "10px 14px", background: "#fafbfc", borderBottom: "1px solid #e7e9ef", fontSize: 12, fontWeight: 600 }}>💬 Kern对话卡 · 摘要层</div>
            <div style={{ padding: "12px", maxHeight: "800px", overflowY: "auto" }}>
              <ResponseView envelope={envelope} defaultDensity="summary" />
            </div>
          </div>
          <div style={{ minHeight: "800px" }}>
            <KernArtifactPanel artifact={currentArtifact} artifacts={artifacts} onSelect={handleSelectArtifact} />
          </div>
        </div>
      )}

      {viewMode === "artifact" && (
        <KernArtifactPanel artifact={currentArtifact} artifacts={artifacts} onSelect={handleSelectArtifact} />
      )}

      {viewMode === "envelope" && (
        <div className="envelope-preview">
          <ResponseView envelope={envelope} defaultDensity="full" />
        </div>
      )}

      <div className="html-report-footer">
        <small>
          💡 <strong>Kern完美结合：</strong>左侧对话卡（摘要层 lede+keypoints+decision）+ 右侧Artifact面板（完整层富可视化15组件+8动效）数据同源，harness R1-R17统一守门。
          动效：fadeInUp/countUp/growWidth/drawArc/drawDonut/pulse/shimmer/float，60fps，支持prefers-reduced-motion。
          无外部依赖，全部内联，Claude Web风格超越版。
        </small>
      </div>
    </div>
  );
}
