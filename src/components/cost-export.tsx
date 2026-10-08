"use client";

import * as React from "react";
import type { ModularCostResult } from "@/modules/cost-engine/modules/types";
import type { BomItem } from "@/modules/cost-engine/bom-import";
import type { SupplierQuote } from "@/modules/cost-engine/supplier-quote";

export function CostExport({
  result,
  category,
  bomItems = [],
  supplierQuotes = [],
}: {
  result: ModularCostResult | null;
  category: string;
  bomItems?: BomItem[];
  supplierQuotes?: SupplierQuote[];
}) {
  const handleExportCsv = () => {
    if (!result) return;
    const lines = [
      `类别,${category}`,
      `总成本,${result.breakdown.totalCost.toFixed(2)}`,
      `原料,${result.breakdown.totalMaterial.toFixed(2)}`,
      `生产,${result.breakdown.totalManufacturing.toFixed(2)}`,
      `包装,${result.breakdown.totalPackaging.toFixed(2)}`,
      `物流,${result.breakdown.totalLogistics.toFixed(2)}`,
      `合规,${result.breakdown.totalCompliance.toFixed(2)}`,
      `渠道,${result.breakdown.totalChannel.toFixed(2)}`,
      ``,
      `模块明细`,
      `模块,字段,值,说明`,
      ...result.modules.map(m => `${m.moduleId},${m.label},${Object.values(m.breakdown || {}).join("|")},${m.breakdown || ""}`),
      ``,
      `BOM`,
      `名称,数量,单位,单价,成本,供应商`,
      ...bomItems.map(b => `${b.name},${b.quantity},${b.unit},${b.unitPrice},${b.cost},${b.supplier || ""}`),
      ``,
      `供应商`,
      `产品,供应商,单价,MOQ,交期`,
      ...supplierQuotes.map(q => `${q.productName},${q.supplierName},${q.unitPrice},${q.moq},${q.leadTime}`),
      ``,
      `告警`,
      ...result.warnings.map(w => `${w}`),
    ];
    const csv = lines.join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-${category}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopySummary = async () => {
    if (!result) return;
    const summary = `【${category}成本核算】
总成本 ¥${result.breakdown.totalCost.toFixed(2)}
原料 ¥${result.breakdown.totalMaterial.toFixed(2)} + 生产 ¥${result.breakdown.totalManufacturing.toFixed(2)} + 包装 ¥${result.breakdown.totalPackaging.toFixed(2)} + 物流 ¥${result.breakdown.totalLogistics.toFixed(2)} + 合规 ¥${result.breakdown.totalCompliance.toFixed(2)} + 渠道 ¥${result.breakdown.totalChannel.toFixed(2)}
建议零售 ¥${(result.breakdown.totalCost * 2.5).toFixed(0)}
BOM ${bomItems.length}种 供应商${supplierQuotes.length}家
告警：${result.warnings[0] || "无"}`;
    await navigator.clipboard.writeText(summary);
    alert("已复制到剪贴板");
  };

  if (!result) return null;

  return (
    <div className="cost-export">
      <button onClick={handleExportCsv}>📤 导出CSV</button>
      <button onClick={handleCopySummary}>📋 复制摘要</button>
      <button onClick={() => window.print()}>🖨️ 打印</button>
    </div>
  );
}
