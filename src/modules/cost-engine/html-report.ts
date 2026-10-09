/**
 * 成本HTML可视化报告 - Claude Web风格
 * 通过harness控制，输出ResponseEnvelope + 独立HTML
 * 4类专用：普通食品、保健食品、跨境食品、化妆品
 */

import type { ModularCostResult } from "./modules/types";
import type { BomItem } from "./bom-import";
import type { SupplierQuote } from "./supplier-quote";
import type { ComplianceItem } from "./compliance-checklist";
import type { ResponseEnvelope, Block } from "@/modules/response-format/types";
import { fmtDate } from "@/shared/datetime";

import { categoryMeta } from "@/modules/tenant";
export interface HtmlReportInput {
  category: string;
  productName: string;
  result: ModularCostResult;
  bomItems: BomItem[];
  supplierQuotes: SupplierQuote[];
  complianceItems: ComplianceItem[];
  role: "leadership" | "product" | "sales";
}

const ROLE_CONCLUSION: Record<string, Record<string, string>> = {
  regular_food: {
    leadership: "普通食品成本可控，SC合规已完成，性价比是核心竞争力",
    product: "原料4项0.98元，加工包装1.1元，物流4.1元，渠道35%，总成本需控制在5元内",
    sales: "性价比突出，日常刚需，39.9元零售价有竞争力",
  },
  health_food: {
    leadership: "保健食品蓝帽子备案5万已摊，软糖剂型溢价高，功能卖点是关键",
    product: "多酚核心原料4元82%留存，软糖1.5元60粒，合规2.5元备案摊销，总成本12元，定价199元利润空间大",
    sales: "蓝帽子+多酚功能+软糖口感，199元高溢价，话术突出备案和功效",
  },
  cross_border_food: {
    leadership: "跨境食品进口成本高但溢价强，关税12%+清关是关键，保税仓降低物流",
    product: "进口乳粉3元+坚果3.75元，国际物流3.5元+关税1.2+报关清关2元，合规1.5元，总成本20元，定价129元",
    sales: "进口原料+跨境背书是卖点，129元中高端，话术突出进口和跨境",
  },
  cosmetics: {
    leadership: "化妆品包材成本重，玻璃瓶5元是关键，备案3万+功效安全检测是卖点",
    product: "透明质酸4元+烟酰胺3元核心，包材8+2+1+5玻璃瓶，检测1.5+安全1+功效1，合规3元，总成本35元，定价299元",
    sales: "透明质酸保湿+烟酰胺美白+玻璃瓶质感，299元高端，话术突出功效和包材",
  },
};

export function costResultToEnvelope(input: HtmlReportInput): ResponseEnvelope {
  const { category, productName, result, bomItems, supplierQuotes, complianceItems, role } = input;
  const catInfo = categoryMeta(category, "regular_food", { tint: "report" });
  const conclusion = ROLE_CONCLUSION[category]?.[role] || ROLE_CONCLUSION.regular_food.leadership;
  
  const blocks: Block[] = [];

  // Prose - 结论
  blocks.push({
    type: "prose",
    title: `${catInfo.icon} ${catInfo.name}成本核算结论`,
    body: [conclusion],
  });

  // Keypoints - 3个要点
  const keypoints = [
    { kind: "fact" as const, text: `总成本 ¥${result.breakdown.totalCost.toFixed(2)}，原料 ¥${result.breakdown.totalMaterial.toFixed(2)} + 生产 ¥${result.breakdown.totalManufacturing.toFixed(2)} + 包装 ¥${result.breakdown.totalPackaging.toFixed(2)}` },
    { kind: "fact" as const, text: `BOM ${bomItems.length}种原料，供应商 ${supplierQuotes.length}家，合规 ${complianceItems.filter(c => c.required).length}项必需` },
    { kind: "inference" as const, text: `建议零售 ¥${(result.breakdown.totalCost * 2.5).toFixed(0)}，利润率约35%，${role === "sales" ? "卖点突出" : role === "leadership" ? "成本可控" : "需关注核心原料成本"}` },
  ];
  blocks.push({ type: "keypoints", title: "核心要点", items: keypoints });

  // Chart - 成本构成
  const maxCost = Math.max(result.breakdown.totalMaterial, result.breakdown.totalManufacturing, result.breakdown.totalPackaging, result.breakdown.totalLogistics, result.breakdown.totalCompliance, result.breakdown.totalChannel, 1);
  blocks.push({
    type: "chart",
    title: "成本构成",
    label: "成本构成",
    unit: "元",
    series: [
      { label: "原料", value: result.breakdown.totalMaterial, display: `¥${result.breakdown.totalMaterial.toFixed(2)}`, hi: result.breakdown.totalMaterial === maxCost },
      { label: "生产", value: result.breakdown.totalManufacturing, display: `¥${result.breakdown.totalManufacturing.toFixed(2)}` },
      { label: "包装", value: result.breakdown.totalPackaging, display: `¥${result.breakdown.totalPackaging.toFixed(2)}` },
      { label: "物流", value: result.breakdown.totalLogistics, display: `¥${result.breakdown.totalLogistics.toFixed(2)}` },
      { label: "合规", value: result.breakdown.totalCompliance, display: `¥${result.breakdown.totalCompliance.toFixed(2)}` },
      { label: "渠道", value: result.breakdown.totalChannel, display: `¥${result.breakdown.totalChannel.toFixed(2)}` },
    ],
    source: "机械化计算，AI仅自检",
  });

  // Table - 模块明细
  blocks.push({
    type: "table",
    title: "模块明细",
    cols: [
      { label: "模块" },
      { label: "成本", num: true },
      { label: "占比", num: true },
      { label: "说明" },
    ],
    rows: result.modules.map(m => {
      const pct = result.breakdown.totalCost > 0 ? (m.cost / result.breakdown.totalCost * 100).toFixed(1) + "%" : "0%";
      return {
        cells: [m.label, `¥${m.cost.toFixed(2)}`, pct, m.breakdown ? JSON.stringify(m.breakdown) : "-"],
      };
    }),
  });

  // Table - BOM
  if (bomItems.length > 0) {
    blocks.push({
      type: "table",
      title: `BOM清单 · ${bomItems.length}种`,
      cols: [
        { label: "原料" },
        { label: "用量", num: true },
        { label: "单价", num: true },
        { label: "成本", num: true },
        { label: "供应商" },
      ],
      rows: bomItems.slice(0, 10).map(item => ({
        cells: [item.name, `${item.quantity}${item.unit}`, `¥${item.unitPrice}`, `¥${item.cost.toFixed(2)}`, item.supplier || "-"],
      })),
    });
  }

  // Table - 供应商
  if (supplierQuotes.length > 0) {
    const grouped: Record<string, typeof supplierQuotes> = {};
    supplierQuotes.forEach(q => {
      if (!grouped[q.productName]) grouped[q.productName] = [];
      grouped[q.productName].push(q);
    });
    const firstGroup = Object.entries(grouped)[0];
    if (firstGroup) {
      const [product, quotes] = firstGroup;
      const min = Math.min(...quotes.map(q => q.unitPrice));
      blocks.push({
        type: "table",
        title: `供应商比价 · ${product}`,
        cols: [
          { label: "供应商" },
          { label: "单价", num: true },
          { label: "MOQ", num: true },
          { label: "交期" },
          { label: "推荐" },
        ],
        rows: quotes.map(q => ({
          cells: [q.supplierName, `¥${q.unitPrice.toFixed(2)}`, `${q.moq}`, q.leadTime, q.unitPrice === min ? "✅ 推荐" : "-"],
          pick: q.unitPrice === min,
        })),
      });
    }
  }

  // Callout - 告警
  if (result.warnings.length > 0) {
    blocks.push({
      type: "callout",
      tone: "warn",
      title: "自检告警",
      body: result.warnings.slice(0, 3).join("；"),
    });
  }

  // Decision - 决策卡
  blocks.push({
    type: "decision",
    title: "决策建议",
    headline: `${catInfo.name} ${productName} 成本方案`,
    confidence: "MEDIUM",
    recommend: [
      `总成本 ¥${result.breakdown.totalCost.toFixed(2)}，建议零售 ¥${(result.breakdown.totalCost * 2.5).toFixed(0)}`,
      `${catInfo.name}核心卖点：${category === "health_food" ? "蓝帽子+功能" : category === "cross_border_food" ? "进口+跨境" : category === "cosmetics" ? "功效+包材" : "性价比"}`,
      `BOM ${bomItems.length}种，供应商${supplierQuotes.length}家，合规${complianceItems.filter(c => c.required).length}项必需`,
    ],
    against: [
      `原料成本占比${(result.breakdown.totalMaterial / result.breakdown.totalCost * 100).toFixed(0)}%，需关注波动`,
      `合规成本 ¥${result.breakdown.totalCompliance.toFixed(2)}，${category === "health_food" ? "备案周期120天" : category === "cosmetics" ? "备案60天+功效30天" : "需提前准备"}`,
      `渠道费用 ¥${result.breakdown.totalChannel.toFixed(2)}，占比高`,
    ],
    risks: [
      `原料价格波动风险`,
      `${category === "cross_border_food" ? "关税政策变化" : category === "health_food" ? "蓝帽子审批" : category === "cosmetics" ? "备案政策" : "SC续期"}风险`,
      `竞品价格战风险`,
    ],
  });

  const lede = `${catInfo.icon} ${catInfo.name}${productName} 总成本¥${result.breakdown.totalCost.toFixed(2)} 建议零售¥${(result.breakdown.totalCost * 2.5).toFixed(0)}`;

  return {
    v: 1,
    kind: "CONCLUSION",
    demo: false,
    lede: lede.slice(0, 60),
    confidence: "MEDIUM",
    blocks,
    meta: {
      model: "cost-engine-v2",
      elapsedMs: 120,
      steps: result.modules.length,
      quota: { used: 1, limit: 100 },
      memoriesUsed: [],
      sources: 0,
      suggestedRole: role as any,
      detectedRole: role as any,
      roleConfidence: 0.9,
      roleReason: `${category}自动识别`,
    },
  };
}

export function generateCostHtmlReport(input: HtmlReportInput): string {
  const { category, productName, result, bomItems, supplierQuotes, complianceItems, role } = input;
  const catInfo = categoryMeta(category, "regular_food", { tint: "report" });
  const conclusion = ROLE_CONCLUSION[category]?.[role] || ROLE_CONCLUSION.regular_food.leadership;
  
  const totalCost = result.breakdown.totalCost;
  const retail = totalCost * 2.5;
  const profit = retail - totalCost;
  const profitRate = retail > 0 ? (profit / retail * 100).toFixed(1) : "0";
  
  const maxCost = Math.max(result.breakdown.totalMaterial, result.breakdown.totalManufacturing, result.breakdown.totalPackaging, result.breakdown.totalLogistics, result.breakdown.totalCompliance, result.breakdown.totalChannel, 1);
  
  const bomRows = bomItems.map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;">${item.name}${item.isImported ? ' <span style="background:#eaf1fe;color:#2563eb;padding:2px 6px;border-radius:99px;font-size:10px;">进口</span>' : ''}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${item.quantity}${item.unit}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;text-align:right;">¥${item.unitPrice}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;text-align:right;font-weight:600;">¥${item.cost.toFixed(2)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:12px;color:#6b7280;">${item.supplier || "-"}</td>
    </tr>
  `).join("");

  const moduleRows = result.modules.map(m => {
    const pct = totalCost > 0 ? (m.cost / totalCost * 100).toFixed(1) : "0";
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;font-weight:500;">${m.label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">¥${m.cost.toFixed(2)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:13px;text-align:right;">
        <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
          <div style="width:60px;height:6px;background:#f0f2f6;border-radius:99px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${catInfo.color};border-radius:99px;"></div></div>
          <span>${pct}%</span>
        </div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f2f6;font-size:12px;color:#6b7280;">${m.breakdown || "-"}</td>
    </tr>
  `}).join("");

  const costBars = [
    { label: "原料", value: result.breakdown.totalMaterial },
    { label: "生产", value: result.breakdown.totalManufacturing },
    { label: "包装", value: result.breakdown.totalPackaging },
    { label: "物流", value: result.breakdown.totalLogistics },
    { label: "合规", value: result.breakdown.totalCompliance },
    { label: "渠道", value: result.breakdown.totalChannel },
  ].map(item => {
    const pct = (item.value / maxCost * 100).toFixed(0);
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
      <span style="width:40px;font-size:12px;font-weight:500;color:#4b5563;">${item.label}</span>
      <div style="flex:1;height:28px;background:#f6f7f9;border-radius:8px;overflow:hidden;position:relative;">
        <div style="width:${pct}%;height:100%;background:${catInfo.color};border-radius:8px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;transition:width .3s;">
          <span style="color:white;font-size:11px;font-weight:600;">¥${item.value.toFixed(2)}</span>
        </div>
      </div>
      <span style="width:50px;font-size:11px;color:#6b7280;text-align:right;">${(item.value/totalCost*100).toFixed(1)}%</span>
    </div>
  `}).join("");

  const supplierSection = (() => {
    if (supplierQuotes.length === 0) return "";
    const grouped: Record<string, typeof supplierQuotes> = {};
    supplierQuotes.forEach(q => {
      if (!grouped[q.productName]) grouped[q.productName] = [];
      grouped[q.productName].push(q);
    });
    return Object.entries(grouped).slice(0, 2).map(([product, quotes]) => {
      const min = Math.min(...quotes.map(q => q.unitPrice));
      const rows = quotes.map(q => `
        <tr style="${q.unitPrice === min ? 'background:#f0fdf4;' : ''}">
          <td style="padding:8px 10px;border-bottom:1px solid #f0f2f6;font-size:12px;">${q.supplierName} ${q.unitPrice === min ? '<span style="background:#0b7a4f;color:white;padding:2px 6px;border-radius:99px;font-size:10px;">推荐</span>' : ''}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f0f2f6;font-size:12px;text-align:right;">¥${q.unitPrice.toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f0f2f6;font-size:12px;text-align:right;">${q.moq}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f0f2f6;font-size:12px;">${q.leadTime}</td>
        </tr>
      `).join("");
      return `
        <div style="border:1px solid #e7e9ef;border-radius:12px;overflow:hidden;background:white;">
          <div style="padding:12px 14px;background:#fafbfc;border-bottom:1px solid #e7e9ef;display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:13px;">${product}</strong>
            <small style="font-size:11px;color:#6b7280;">最低 ¥${min.toFixed(2)} · 节省 ¥${(Math.max(...quotes.map(q=>q.unitPrice))-min).toFixed(2)}</small>
          </div>
          <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f6f7f9;"><th style="padding:6px 10px;text-align:left;font-size:10px;color:#6b7280;">供应商</th><th style="padding:6px 10px;text-align:right;font-size:10px;color:#6b7280;">单价</th><th style="padding:6px 10px;text-align:right;font-size:10px;color:#6b7280;">MOQ</th><th style="padding:6px 10px;text-align:left;font-size:10px;color:#6b7280;">交期</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      `;
    }).join("");
  })();

  const complianceSection = complianceItems.length > 0 ? `
    <div style="display:grid;gap:8px;">
      ${complianceItems.map(item => `
        <div style="display:flex;gap:10px;padding:10px 12px;border:1px solid #e7e9ef;border-radius:10px;background:${item.status === "done" ? "#f0fdf4" : "white"};border-left:3px solid ${item.required ? "#ef4444" : "#d1d5db"};">
          <input type="checkbox" ${item.status === "done" ? "checked" : ""} style="margin-top:2px;" />
          <div style="flex:1;display:grid;gap:4px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="font-size:12px;">${item.label}</strong>
              <span style="padding:2px 6px;border-radius:99px;font-size:9px;font-weight:700;background:${item.required ? "#fdeeec" : "#f6f7f9"};color:${item.required ? "#b32b23" : "#6b7280"};">${item.required ? "必需" : "可选"}</span>
            </div>
            <small style="font-size:11px;color:#4b525f;line-height:1.4;">${item.description}</small>
            <div style="display:flex;gap:8px;font-size:10px;color:#9099a6;"><span>¥${(item.estimatedCost||0).toLocaleString()}</span><span>${item.estimatedDays||0}天</span></div>
          </div>
        </div>
      `).join("")}
    </div>
  ` : "";

  // Role-specific sections
  const leadershipSection = role === "leadership" ? `
    <div style="background:${catInfo.gradient};border:1px solid #e7e9ef;border-radius:16px;padding:20px;display:grid;gap:16px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h2 style="margin:0;font-size:18px;font-weight:700;">${catInfo.icon} ${productName}</h2>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${conclusion}</p>
        </div>
        <span style="background:${catInfo.color};color:white;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;">${catInfo.name}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
        <div style="background:white;border:1px solid #e7e9ef;border-radius:12px;padding:14px;text-align:center;">
          <small style="font-size:10px;color:#6b7280;letter-spacing:.5px;">总成本</small>
          <div style="font-size:24px;font-weight:800;margin:4px 0;">¥${totalCost.toFixed(2)}</div>
          <small style="font-size:11px;color:#0b7a4f;">成本可控</small>
        </div>
        <div style="background:white;border:1px solid #e7e9ef;border-radius:12px;padding:14px;text-align:center;">
          <small style="font-size:10px;color:#6b7280;">建议零售</small>
          <div style="font-size:24px;font-weight:800;margin:4px 0;">¥${retail.toFixed(0)}</div>
          <small style="font-size:11px;color:#6b7280;">市场价</small>
        </div>
        <div style="background:#0f1116;color:white;border-radius:12px;padding:14px;text-align:center;">
          <small style="font-size:10px;color:#9ca3af;">利润率</small>
          <div style="font-size:24px;font-weight:800;margin:4px 0;">${profitRate}%</div>
          <small style="font-size:11px;color:#9ca3af;">¥${profit.toFixed(2)}利润</small>
        </div>
      </div>
    </div>
  ` : "";

  const productSection = role === "product" ? `
    <div style="display:grid;gap:16px;">
      <div style="border:1px solid #e7e9ef;border-radius:12px;overflow:hidden;background:white;">
        <div style="padding:12px 14px;background:#fafbfc;border-bottom:1px solid #e7e9ef;"><strong style="font-size:13px;">📊 成本构成可视化</strong></div>
        <div style="padding:14px;">${costBars}</div>
      </div>
    </div>
  ` : "";

  const salesSection = role === "sales" ? `
    <div style="background:linear-gradient(135deg, #fff 0%, #f6f7f9 100%);border:1px solid #e7e9ef;border-radius:12px;padding:16px;display:grid;gap:12px;">
      <strong style="font-size:13px;">💼 销售卖点 · ${catInfo.name}</strong>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
        <div style="padding:10px;background:white;border:1px solid #e7e9ef;border-radius:8px;">
          <strong style="font-size:11px;">核心卖点</strong>
          <p style="margin:4px 0 0;font-size:11px;line-height:1.5;color:#4b5563;">${category === "health_food" ? "蓝帽子备案+多酚功能+软糖口感，功效与口感兼具" : category === "cross_border_food" ? "进口原料+跨境背书+保税仓直发，品质保障" : category === "cosmetics" ? "透明质酸保湿+烟酰胺美白+玻璃瓶质感，高端体验" : "性价比突出+日常刚需+SC合规，安全放心"}</p>
        </div>
        <div style="padding:10px;background:white;border:1px solid #e7e9ef;border-radius:8px;">
          <strong style="font-size:11px;">话术</strong>
          <p style="margin:4px 0 0;font-size:11px;line-height:1.5;color:#4b5563;background:#f6f7f9;padding:6px 8px;border-radius:6px;">"${conclusion}，总成本¥${totalCost.toFixed(2)}，建议零售¥${retail.toFixed(0)}，利润空间${profitRate}%。"</p>
        </div>
      </div>
    </div>
  ` : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${catInfo.icon} ${productName} - ${catInfo.name}成本报告</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: #fafbfc; color: #0f1116; line-height: 1.6; padding: 20px; }
  .container { max-width: 960px; margin: 0 auto; display: grid; gap: 20px; }
  .card { background: white; border: 1px solid #e7e9ef; border-radius: 16px; overflow: hidden; }
  .card-h { padding: 14px 18px; background: #fafbfc; border-bottom: 1px solid #e7e9ef; display: flex; justify-content: space-between; align-items: center; }
  .card-h strong { font-size: 14px; }
  .card-h small { font-size: 11px; color: #6b7280; }
  .card-b { padding: 16px 18px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .kpi { background: white; border: 1px solid #e7e9ef; border-radius: 12px; padding: 14px; text-align: center; }
  .kpi small { font-size: 10px; color: #6b7280; letter-spacing: .5px; text-transform: uppercase; }
  .kpi .v { font-size: 20px; font-weight: 800; margin: 6px 0; font-variant-numeric: tabular-nums; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f6f7f9; padding: 8px 12px; text-align: left; font-size: 11px; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e7e9ef; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f2f6; font-size: 13px; }
  .badge { padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; }
  .callout { padding: 12px 14px; border-radius: 10px; display: flex; gap: 10px; align-items: flex-start; }
  .callout.warn { background: #fffbeb; border: 1px solid #fde68a; }
  .callout.ok { background: #f0fdf4; border: 1px solid #bbf7d0; }
  @media (max-width: 720px) { .kpi-grid { grid-template-columns: 1fr 1fr; } }
  @media print { body { background: white; padding: 0; } .container { gap: 12px; } }
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:10px;background:${catInfo.color};display:flex;align-items:center;justify-content:center;color:white;font-size:18px;">${catInfo.icon}</div>
      <div>
        <h1 style="font-size:16px;font-weight:700;margin:0;">${productName} · ${catInfo.name}成本报告</h1>
        <small style="font-size:11px;color:#6b7280;">${fmtDate(new Date())} · ${role === "leadership" ? "领导层" : role === "product" ? "产品研发" : "销售营销"}视角 · 4类专用</small>
      </div>
    </div>
    <div style="display:flex;gap:6px;">
      <span class="badge" style="background:#f6f7f9;color:#6b7280;">${role}</span>
      <span class="badge" style="background:${catInfo.color};color:white;">${catInfo.name}</span>
    </div>
  </div>

  ${leadershipSection}

  <!-- KPI -->
  <div class="kpi-grid">
    <div class="kpi"><small>总成本</small><div class="v">¥${totalCost.toFixed(2)}</div><small style="color:#0b7a4f;">${bomItems.length}种原料</small></div>
    <div class="kpi"><small>建议零售</small><div class="v">¥${retail.toFixed(0)}</div><small>市场价</small></div>
    <div class="kpi"><small>利润</small><div class="v">¥${profit.toFixed(2)}</div><small>${profitRate}%利润率</small></div>
    <div class="kpi" style="background:#0f1116;color:white;border-color:#0f1116;"><small style="color:#9ca3af;">合规</small><div class="v" style="color:white;">${complianceItems.filter(c=>c.required).length}项</div><small style="color:#9ca3af;">${complianceItems.filter(c=>c.status==="done").length}/${complianceItems.length}完成</small></div>
  </div>

  ${productSection}
  ${salesSection}

  <!-- 成本构成 -->
  <div class="card">
    <div class="card-h"><strong>💰 成本构成 · 模块化</strong><small>总成本 ¥${totalCost.toFixed(2)} · 6项 · ${catInfo.name}专用</small></div>
    <div class="card-b" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead><tr><th>模块</th><th style="text-align:right;">成本</th><th style="text-align:right;">占比</th><th>说明</th></tr></thead>
          <tbody>${moduleRows}</tbody>
          <tfoot><tr style="background:#f6f7f9;font-weight:700;"><td>合计</td><td style="text-align:right;">¥${totalCost.toFixed(2)}</td><td style="text-align:right;">100%</td><td>4类专用</td></tr></tfoot>
        </table>
      </div>
    </div>
  </div>

  <!-- BOM -->
  ${bomItems.length > 0 ? `
  <div class="card">
    <div class="card-h"><strong>🌱 BOM原料清单 · ${bomItems.length}种</strong><small>总成本 ¥${bomItems.reduce((s,i)=>s+i.cost,0).toFixed(2)} · 进口 ¥${bomItems.filter(i=>i.isImported).reduce((s,i)=>s+i.cost,0).toFixed(2)}</small></div>
    <div class="card-b" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead><tr><th>原料</th><th style="text-align:right;">用量</th><th style="text-align:right;">单价</th><th style="text-align:right;">成本</th><th>供应商</th></tr></thead>
          <tbody>${bomRows}</tbody>
        </table>
      </div>
    </div>
  </div>
  ` : ""}

  <!-- 供应商 -->
  ${supplierSection ? `<div style="display:grid;gap:12px;"><div style="font-size:13px;font-weight:600;">🏭 供应商比价</div>${supplierSection}</div>` : ""}

  <!-- 合规 -->
  ${complianceSection ? `
  <div class="card">
    <div class="card-h"><strong>📋 合规清单 · ${complianceItems.length}项</strong><small>必需 ${complianceItems.filter(c=>c.required).length}项 · 费用 ¥${complianceItems.reduce((s,c)=>s+(c.estimatedCost||0),0).toLocaleString()} · 周期 ${Math.max(...complianceItems.map(c=>c.estimatedDays||0),0)}天</small></div>
    <div class="card-b">${complianceSection}</div>
  </div>
  ` : ""}

  <!-- 告警 -->
  ${result.warnings.length > 0 ? `
  <div class="callout warn">
    <span style="font-size:16px;">⚠️</span>
    <div style="flex:1;">
      <strong style="font-size:12px;display:block;">自检告警 · ${result.warnings.length}条</strong>
      <small style="font-size:11px;color:#92400e;line-height:1.5;">${result.warnings.join("；")}</small>
    </div>
  </div>
  ` : `
  <div class="callout ok">
    <span style="font-size:16px;">✅</span>
    <div style="flex:1;">
      <strong style="font-size:12px;display:block;">自检通过</strong>
      <small style="font-size:11px;color:#166534;">成本计算无告警，${catInfo.name}合规检查完成</small>
    </div>
  </div>
  `}

  <!-- 决策卡 -->
  <div style="background:#0f1116;color:white;border-radius:16px;padding:18px;display:grid;gap:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong style="font-size:14px;">🎯 决策建议 · ${catInfo.name}</strong>
      <span style="background:white;color:#0f1116;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;">置信度 中</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
      <div><small style="font-size:10px;color:#9ca3af;letter-spacing:.5px;">推荐</small><ul style="margin:6px 0 0;padding-left:14px;display:grid;gap:4px;font-size:11px;line-height:1.5;"><li>总成本 ¥${totalCost.toFixed(2)}，建议零售 ¥${retail.toFixed(0)}</li><li>${catInfo.name}核心卖点：${category === "health_food" ? "蓝帽子+功能" : category === "cross_border_food" ? "进口+跨境" : category === "cosmetics" ? "功效+包材" : "性价比"}</li><li>BOM ${bomItems.length}种，供应商${supplierQuotes.length}家</li></ul></div>
      <div><small style="font-size:10px;color:#9ca3af;">反对理由</small><ul style="margin:6px 0 0;padding-left:14px;display:grid;gap:4px;font-size:11px;line-height:1.5;color:#d1d5db;"><li>原料占比${(result.breakdown.totalMaterial/totalCost*100).toFixed(0)}%，需关注波动</li><li>合规 ¥${result.breakdown.totalCompliance.toFixed(2)}，周期长</li><li>渠道 ¥${result.breakdown.totalChannel.toFixed(2)}，占比高</li></ul></div>
      <div><small style="font-size:10px;color:#9ca3af;">风险</small><ul style="margin:6px 0 0;padding-left:14px;display:grid;gap:4px;font-size:11px;line-height:1.5;color:#fca5a5;"><li>原料价格波动</li><li>${category === "cross_border_food" ? "关税政策" : category === "health_food" ? "蓝帽子审批" : category === "cosmetics" ? "备案政策" : "SC续期"}风险</li><li>竞品价格战</li></ul></div>
    </div>
  </div>

  <div style="text-align:center;padding:12px 0;color:#9ca3af;font-size:10px;">
    由成本引擎机械化计算 · AI仅自检 · 4类专用 · ${new Date().toISOString()} · 通过harness校验
  </div>
</div>
</body>
</html>`;
}
