"use client";

import * as React from "react";
import { RoleProvider } from "@/components/role-context";
import { CostCalculatorModular } from "@/components/cost-calculator-modular";
import { CostHtmlReportRich } from "@/components/cost-html-report-rich";
import { calculateCostForProduct } from "@/modules/cost-engine/modules/calculator";
import { getBomTemplate } from "@/modules/cost-engine/bom-import";
import { getSupplierTemplate } from "@/modules/cost-engine/supplier-quote";
import { getComplianceChecklist } from "@/modules/cost-engine/compliance-checklist";

export default function DemoCostRichPage() {
  const [category, setCategory] = React.useState("health_food");
  
  const result = React.useMemo(() => {
    try {
      return calculateCostForProduct(category === "health_food" ? "多酚软糖" : category === "regular_food" ? "燕麦饼干" : category === "cross_border_food" ? "进口坚果" : "玻尿酸精华", category);
    } catch {
      return null;
    }
  }, [category]);

  const bomItems = React.useMemo(() => getBomTemplate(category), [category]);
  const supplierQuotes = React.useMemo(() => getSupplierTemplate(category), [category]);
  const complianceItems = React.useMemo(() => getComplianceChecklist(category), [category]);

  return (
    <RoleProvider>
      <div style={{ padding: 20, maxWidth: 1400, margin: "0 auto", display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>🎨 Kern + 富可视化 · 15组件+8动效 · 演示</h1>
            <small style={{ fontSize: 11, color: "#6b7280" }}>Claude Web风格超越版 · 通过harness R1-R17 · 左侧对话卡+右侧Artifact数据同源</small>
          </div>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <option value="regular_food">🍪 普通食品</option>
            <option value="health_food">💊 保健食品</option>
            <option value="cross_border_food">🌍 跨境食品</option>
            <option value="cosmetics">💄 化妆品</option>
          </select>
        </div>

        <div style={{ background: "white", border: "1px solid #e7e9ef", borderRadius: 16, padding: 16 }}>
          <CostCalculatorModular />
        </div>

        <div style={{ background: "white", border: "1px solid #e7e9ef", borderRadius: 16, padding: 16 }}>
          <h3 style={{ fontSize: 14, margin: "0 0 12px" }}>🎨 富可视化独立演示 · {category}</h3>
          {result ? (
            <CostHtmlReportRich
              category={category}
              productName={category === "health_food" ? "多酚软糖" : category === "regular_food" ? "燕麦饼干" : category === "cross_border_food" ? "进口坚果" : "玻尿酸精华"}
              result={result}
              bomItems={bomItems}
              supplierQuotes={supplierQuotes}
              complianceItems={complianceItems}
            />
          ) : (
            <div>计算中...</div>
          )}
        </div>
      </div>
    </RoleProvider>
  );
}
