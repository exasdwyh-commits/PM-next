"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { costResultToEnvelope, generateCostHtmlReport, type HtmlReportInput } from "@/modules/cost-engine/html-report";
import { validate } from "@/modules/response-format/validate";
import { ResponseView } from "@/app/muse/response/response-view";
import type { ModularCostResult } from "@/modules/cost-engine/modules/types";
import type { BomItem } from "@/modules/cost-engine/bom-import";
import type { SupplierQuote } from "@/modules/cost-engine/supplier-quote";
import type { ComplianceItem } from "@/modules/cost-engine/compliance-checklist";
import { Notice, type NoticeMessage } from "./notice";
import { categoryMeta } from "@/modules/tenant";
import "./cost-html-report.css";

export function CostHtmlReport({
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
  const [viewMode, setViewMode] = React.useState<"claude" | "envelope" | "html">("claude");
  const [msg, setMsg] = React.useState<NoticeMessage | null>(null);
  const [htmlContent, setHtmlContent] = React.useState("");

  const input: HtmlReportInput | null = React.useMemo(() => {
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
    return costResultToEnvelope(input);
  }, [input]);

  const validation = React.useMemo(() => {
    if (!envelope) return null;
    return validate(envelope);
  }, [envelope]);

  React.useEffect(() => {
    if (input) {
      const html = generateCostHtmlReport(input);
      setHtmlContent(html);
    }
  }, [input]);

  const handleDownloadHtml = () => {
    if (!htmlContent) return;
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-report-${category}-${productName}-${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyHtml = async () => {
    if (!htmlContent) return;
    await navigator.clipboard.writeText(htmlContent);
    setMsg({ tone: "ok", text: "HTML已复制，可直接粘贴到浏览器或Claude" });
  };

  const handlePrint = () => {
    if (!htmlContent) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(htmlContent);
    w.document.close();
    w.print();
  };

  if (!result || !input || !envelope) {
    return <div className="cost-html-report empty">暂无成本数据，请先完成成本核算</div>;
  }

  return (
    <div className="cost-html-report" data-role={role}>
      <Notice msg={msg} onClose={() => setMsg(null)} />
      <div className="html-report-header">
        <div>
          <h4>🎨 Claude风格可视化报告 · HTML格式</h4>
          <small>
            {categoryMeta(category).icon}{categoryMeta(category).name} · {productName} · {role}视角 · 
            {validation ? (validation.filter(v => v.level === "error").length === 0 ? "✅ 通过harness校验" : `❌ ${validation.filter(v=>v.level==="error").length}个error`) : "校验中"} · 
            {envelope.blocks.length}个Block
          </small>
        </div>
        <div className="html-report-actions">
          <div className="view-tabs">
            <button className={viewMode === "claude" ? "active" : ""} onClick={() => setViewMode("claude")}>🎨 Claude风格</button>
            <button className={viewMode === "envelope" ? "active" : ""} onClick={() => setViewMode("envelope")}>📦 Envelope</button>
            <button className={viewMode === "html" ? "active" : ""} onClick={() => setViewMode("html")}>📄 HTML源码</button>
          </div>
          <div className="export-actions">
            <button onClick={handleDownloadHtml}>📥 下载HTML</button>
            <button onClick={handleCopyHtml}>📋 复制HTML</button>
            <button onClick={handlePrint}>🖨️ 打印</button>
          </div>
        </div>
      </div>

      {validation && validation.length > 0 && (
        <div className="harness-panel">
          <strong>🔍 Harness校验 · {validation.length}条</strong>
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

      {viewMode === "claude" && (
        <div className="claude-preview">
          <iframe srcDoc={htmlContent} title="Claude风格成本报告" sandbox="allow-same-origin" style={{ width: "100%", height: "800px", border: "1px solid #e7e9ef", borderRadius: "12px", background: "white" }} />
        </div>
      )}

      {viewMode === "envelope" && (
        <div className="envelope-preview">
          <ResponseView envelope={envelope} />
        </div>
      )}

      {viewMode === "html" && (
        <div className="html-source">
          <pre><code>{htmlContent.slice(0, 5000)}{htmlContent.length > 5000 ? "\n...（省略，下载查看完整）" : ""}</code></pre>
        </div>
      )}

      <div className="html-report-footer">
        <small>💡 提示：Claude风格HTML采用内联样式，无外部依赖，可直接作为Artifact分享，支持打印和PDF导出。通过harness校验确保符合ResponseEnvelope规范。</small>
      </div>
    </div>
  );
}
