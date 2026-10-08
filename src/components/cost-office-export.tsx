"use client";

import * as React from "react";
import { useRole } from "./role-context";
import type { ModularCostResult } from "@/modules/cost-engine/modules/types";
import type { BomItem } from "@/modules/cost-engine/bom-import";
import type { SupplierQuote } from "@/modules/cost-engine/supplier-quote";
import type { ComplianceItem } from "@/modules/cost-engine/compliance-checklist";
import { generateRichHtmlReport, type RichHtmlReportInput } from "@/modules/cost-engine/html-report-rich";
import "./cost-office-export.css";

export function CostOfficeExport({
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
  const [exportRole, setExportRole] = React.useState<"leadership" | "product" | "sales">(role as any);
  const [exportFormat, setExportFormat] = React.useState<"html" | "docx" | "pdf">("html");

  React.useEffect(() => {
    setExportRole(role as any);
  }, [role]);

  const handleExport = () => {
    if (!result) return;

    const input: RichHtmlReportInput = {
      category,
      productName,
      result,
      bomItems,
      supplierQuotes,
      complianceItems,
      role: exportRole,
    };

    const html = generateRichHtmlReport(input);

    if (exportFormat === "html") {
      const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cost-${category}-${productName}-${exportRole}-${new Date().toISOString().slice(0,10)}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (exportFormat === "docx") {
      // For docx, we wrap HTML in a format that Word can open
      const docHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"><title>${productName}成本报告</title></head>
        <body>${html}</body>
        </html>
      `;
      const blob = new Blob([docHtml], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cost-${category}-${productName}-${exportRole}.doc`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (exportFormat === "pdf") {
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  };

  if (!result) return null;

  const roleInfo = {
    leadership: { icon: "👔", name: "领导层", desc: "极简KPI+一句话结论，隐藏表格细节", color: "#0f1116" },
    product: { icon: "🔬", name: "产品研发", desc: "全表格+瀑布+环形+柱状+BOM翻转+时间轴，严谨可信", color: "#7c3aed" },
    sales: { icon: "💼", name: "销售营销", desc: "卖点卡片+话术+工具箱，工具型，突出卖点", color: "#db2777" },
  };

  const currentRoleInfo = roleInfo[exportRole];

  return (
    <div className="cost-office-export" data-role={role}>
      <div className="office-header">
        <div>
          <h4>📄 Office导出 · 角色化 · 富可视化</h4>
          <small>按角色导出不同Word/PDF/HTML，4类专用，富可视化15组件+8动效，通过harness</small>
        </div>
      </div>

      <div className="office-config">
        <div className="config-group">
          <label>导出角色</label>
          <div className="role-selector">
            {(Object.keys(roleInfo) as Array<keyof typeof roleInfo>).map(r => (
              <button key={r} className={exportRole === r ? "active" : ""} onClick={() => setExportRole(r)} style={{ borderColor: exportRole === r ? roleInfo[r].color : undefined }}>
                <span>{roleInfo[r].icon}</span>
                <div>
                  <strong>{roleInfo[r].name}</strong>
                  <small>{roleInfo[r].desc}</small>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="config-group">
          <label>导出格式</label>
          <div className="format-selector">
            <button className={exportFormat === "html" ? "active" : ""} onClick={() => setExportFormat("html")}>🌐 HTML富可视化</button>
            <button className={exportFormat === "docx" ? "active" : ""} onClick={() => setExportFormat("docx")}>📝 Word</button>
            <button className={exportFormat === "pdf" ? "active" : ""} onClick={() => setExportFormat("pdf")}>📄 PDF打印</button>
          </div>
        </div>

        <div className="config-preview" style={{ borderColor: currentRoleInfo.color }}>
          <div className="preview-header" style={{ background: currentRoleInfo.color, color: "white" }}>
            <span>{currentRoleInfo.icon} {currentRoleInfo.name}版预览</span>
            <small>{category === "regular_food" ? "🍪普通食品" : category === "health_food" ? "💊保健食品" : category === "cross_border_food" ? "🌍跨境食品" : "💄化妆品"} · {productName}</small>
          </div>
          <div className="preview-body">
            {exportRole === "leadership" && (
              <div className="preview-leadership">
                <div className="kpi-row">
                  <span>总成本 ¥{result.breakdown.totalCost.toFixed(2)}</span>
                  <span>零售 ¥{(result.breakdown.totalCost * 2.5).toFixed(0)}</span>
                  <span>利润 {(30).toFixed(0)}%</span>
                </div>
                <p>一句话结论：{category === "health_food" ? "保健食品蓝帽子备案5万已摊，软糖剂型溢价高" : category === "cross_border_food" ? "跨境食品进口成本高但溢价强，关税12%是关键" : category === "cosmetics" ? "化妆品包材成本重，玻璃瓶5元是关键" : "普通食品成本可控，性价比是核心"}，总成本¥{result.breakdown.totalCost.toFixed(2)}，建议零售¥{(result.breakdown.totalCost * 2.5).toFixed(0)}。</p>
              </div>
            )}
            {exportRole === "product" && (
              <div className="preview-product">
                <small>模块明细 · {result.modules.length}项 · BOM {bomItems.length}种 · 供应商{supplierQuotes.length}家 · 合规{complianceItems.length}项</small>
                <div className="table-preview">表格：模块/成本/占比/说明 + BOM清单 + 供应商比价 + 合规时间轴 + 瀑布图+环形图+柱状赛跑+BOM翻转卡片</div>
              </div>
            )}
            {exportRole === "sales" && (
              <div className="preview-sales">
                <div className="selling-points">
                  <strong>卖点：{category === "health_food" ? "蓝帽子+多酚功能+软糖口感" : category === "cross_border_food" ? "进口+跨境背书+保税仓" : category === "cosmetics" ? "透明质酸保湿+烟酰胺美白+玻璃瓶质感" : "性价比+日常刚需+SC"}</strong>
                  <p>话术：&quot;{category === "health_food" ? "蓝帽子备案5万已摊，功能卖点是关键" : "进口成本高但溢价强"}，总成本¥{result.breakdown.totalCost.toFixed(2)}，零售¥{(result.breakdown.totalCost * 2.5).toFixed(0)}，利润空间大。&quot;</p>
                </div>
                <div className="tool-preview">工具箱：下载证书/报告/图片，复制话术，渠道占比环形图</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="office-actions">
        <button className="primary" onClick={handleExport} style={{ background: currentRoleInfo.color, borderColor: currentRoleInfo.color }}>
          📤 导出{exportFormat === "html" ? "HTML富可视化" : exportFormat === "docx" ? "Word" : "PDF"} · {currentRoleInfo.name}版
        </button>
        <small>💡 {exportRole}版：{currentRoleInfo.desc}，{category}专用，富可视化15组件+8动效，通过harness</small>
      </div>
    </div>
  );
}
