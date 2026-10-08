"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { COST_MODULE_REGISTRY } from "@/modules/cost-engine/modules/registry";
import { BomImport } from "./bom-import";
import { SupplierQuoteManager } from "./supplier-quote";
import { ComplianceChecklist } from "./compliance-checklist";
import { CostScenarioManager } from "./cost-scenario-manager";
import { CostExport } from "./cost-export";
import { CostHtmlReport } from "./cost-html-report";
import { CostHtmlReportRich } from "./cost-html-report-rich";
import { KernPromptLibrary } from "./kern-prompt-library";
import { ComplianceEvidenceManager } from "./compliance-evidence";
import { SupplierQualificationManager } from "./supplier-qualification";
import { CostOfficeExport } from "./cost-office-export";
import { CostCalculatorPerformance } from "./cost-calculator-performance";
import "./cost-calculator-performance.css";
import "./compliance-evidence.css";
import "./supplier-qualification.css";
import "./cost-office-export.css";
import { BomVirtualList } from "./bom-virtual-list";
import "./bom-virtual-list.css";
import { t as i18nT, getLocale, setLocale, shouldShowBilingual } from "@/modules/cost-engine/i18n";
import "./kern-prompt-library.css";
import "./cost-html-report.css";
import "./cost-scenario-manager.css";
import "./bom-import.css";
import "./supplier-quote.css";
import "./compliance-checklist.css";
import { listTemplates, getTemplateForProduct, getTemplate } from "@/modules/cost-engine/templates";
import { calculateModularCost } from "@/modules/cost-engine/modules/calculator";
import type { ProductCostTemplate, ModularCostResult } from "@/modules/cost-engine/modules/types";
import "./cost-calculator-modular.css";
import "./role-switch.css";

const CATEGORY_INFO: Record<string, { compliance: string; notes: string }> = {
  regular_food: { compliance: "SC认证 + 标签审核", notes: "普通食品，成本较低，重点在原料和包装" },
  health_food: { compliance: "蓝帽子备案/注册 + 功能声称 + 多项检测", notes: "保健食品，原料贵、检测多、备案费高(5-20万)，需摊销" },
  cross_border_food: { compliance: "进口备案 + 关税 + 中文标签 + 保税仓", notes: "跨境食品，国际物流+关税+清关，税率10-15%" },
  cosmetics: { compliance: "化妆品备案/注册 + 功效/安全检测 + 宣称", notes: "化妆品，包材贵(玻璃瓶)、检测多(5项+)、备案费高" },
};

export function CostCalculatorModular({
  productName,
  productCategory,
  initialTemplateId,
  onSave,
}: {
  productName?: string;
  productCategory?: string;
  initialTemplateId?: string;
  onSave?: (result: ModularCostResult, template: ProductCostTemplate) => void;
}) {
  const { role } = useRole();
  React.useEffect(() => { setLocaleState(getLocale()); }, []);
  const [templateId, setTemplateId] = React.useState<string>(() => {
    if (initialTemplateId && getTemplate(initialTemplateId)) return initialTemplateId;
    const auto = getTemplateForProduct(productName, productCategory);
    return auto.id;
  });
  const [template, setTemplate] = React.useState<ProductCostTemplate>(() => getTemplate(templateId) || getTemplateForProduct(productName, productCategory));
  const [values, setValues] = React.useState<Record<string, Record<string, number>>>({});
  const [result, setResult] = React.useState<ModularCostResult | null>(null);
  const [activeSubTab, setActiveSubTab] = React.useState<"cost" | "bom" | "supplier" | "compliance" | "scenario" | "html" | "prompts">("cost");
  const [bomCost, setBomCost] = React.useState<number>(0);
  const [bomItemsState, setBomItemsState] = React.useState<any[]>([]);
  const [supplierQuotesState, setSupplierQuotesState] = React.useState<any[]>([]);
  const [complianceEvidences, setComplianceEvidences] = React.useState<Record<string, any[]>>({});
  const [supplierQualifications, setSupplierQualifications] = React.useState<Record<string, any[]>>({});
  const [locale, setLocaleState] = React.useState<"zh" | "en">("zh");
  const [useVirtualList, setUseVirtualList] = React.useState(false);

  React.useEffect(() => {
    const t = getTemplate(templateId);
    if (!t) return;
    setTemplate(t);
    const init: Record<string, Record<string, number>> = {};
    for (const mod of t.modules) {
      init[mod.moduleId] = { ...(mod.values as any) };
    }
    setValues(init);
  }, [templateId]);

  React.useEffect(() => {
    if (!template) return;
    try {
      const r = calculateModularCost(template, values);
      setResult(r);
    } catch {}
  }, [template, values]);

  const updateField = (moduleId: string, fieldKey: string, val: string) => {
    const num = val === "" ? 0 : Number(val);
    if (Number.isNaN(num)) return;
    setValues(prev => ({
      ...prev,
      [moduleId]: { ...(prev[moduleId] || {}), [fieldKey]: num },
    }));
  };

  const toggleModule = (moduleId: string) => {
    setTemplate(prev => ({
      ...prev,
      modules: prev.modules.map(m => m.moduleId === moduleId ? { ...m, enabled: !m.enabled } : m),
    }));
  };

  if (!template || !result) return <div>加载中...</div>;

  const catInfo = CATEGORY_INFO[template.id] || { compliance: "", notes: "" };

  return (
    <CostCalculatorPerformance category={template.id || "health_food"}>
    
    <div className="cost-modular" data-role={role}>
      <div className="cost-header">
        <div>
          <span className="eyebrow">成本计算器 · 4类专用 · {role === "leadership" ? "领导视角" : role === "product" ? "研发视角" : "销售视角"}</span>
          <h2>💰 {productName || "产品"} 成本核算</h2>
          <p>{template.icon} {template.name} · {template.description}</p>
          <small style={{ color: "#7c3aed" }}>📋 合规：{catInfo.compliance} · {catInfo.notes}</small>
        </div>
        <div className="template-switch">
          <label>产品类别 (仅4类)</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
            {listTemplates().map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
          </select>
        </div>
      </div>

      <div className="cost-sub-tabs">
        <button className={activeSubTab === "cost" ? "active" : ""} onClick={() => setActiveSubTab("cost")}>💰 成本核算</button>
        <button className={activeSubTab === "bom" ? "active" : ""} onClick={() => setActiveSubTab("bom")}>🌱 BOM清单</button>
        <button className={activeSubTab === "supplier" ? "active" : ""} onClick={() => setActiveSubTab("supplier")}>🏭 供应商</button>
        <button className={activeSubTab === "compliance" ? "active" : ""} onClick={() => setActiveSubTab("compliance")}>📋 合规</button>
        <button className={activeSubTab === "scenario" ? "active" : ""} onClick={() => setActiveSubTab("scenario")}>💾 方案</button>
        <button className={activeSubTab === "html" ? "active" : ""} onClick={() => setActiveSubTab("html")}>🎨 可视化</button>
        <button className={activeSubTab === "prompts" ? "active" : ""} onClick={() => setActiveSubTab("prompts")}>🎯 提示词库</button>
      </div>

      {activeSubTab === "bom" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <input type="checkbox" checked={useVirtualList} onChange={e => setUseVirtualList(e.target.checked)} /> 虚拟滚动(P3-1, 1000+原料)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <input type="checkbox" checked={locale === "en"} onChange={e => { const newLocale = e.target.checked ? "en" : "zh"; setLocaleState(newLocale); setLocale(newLocale); }} /> 英文双语(P3-3, 跨境)
            </label>
            {shouldShowBilingual(templateId) && <small style={{ fontSize: 10, color: "#6b7280" }}>🌍 跨境食品双语：{i18nT(templateId, locale)} / {i18nT(templateId, "en")}</small>}
          </div>
          {useVirtualList ? (
            <BomVirtualList items={bomItemsState.length > 0 ? bomItemsState : []} onUpdate={(id, field, value) => setBomItemsState(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item))} onRemove={(id) => setBomItemsState(prev => prev.filter(item => item.id !== id))} />
          ) : (
            <BomImport category={templateId} onCostChange={(cost, items) => { setBomCost(cost); if (items) setBomItemsState(items); }} />
          )}
        </>
      )}
      {activeSubTab === "supplier" && (
        <>
          <SupplierQuoteManager category={templateId} onSelect={(quotes) => {
            setSupplierQuotesState(quotes);
            const total = quotes.reduce((sum, q) => sum + q.unitPrice, 0);
            if (total > 0) setValues(prev => ({ ...prev, material: { ...(prev.material || {}), materialCost: total } }));
          }} />
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <h5 style={{ fontSize: 13, margin: 0 }}>🏅 供应商资质 · P1-2</h5>
            {supplierQuotesState.slice(0, 2).map((quote: any) => (
              <SupplierQualificationManager
                key={quote.id}
                supplier={quote}
                qualifications={supplierQualifications[quote.id] || []}
                onUpload={(qual) => setSupplierQualifications(prev => ({ ...prev, [quote.id]: [...(prev[quote.id] || []), qual] }))}
                onDelete={(qualId) => setSupplierQualifications(prev => ({ ...prev, [quote.id]: (prev[quote.id] || []).filter((q: any) => q.id !== qualId) }))}
              />
            ))}
            {supplierQuotesState.length === 0 && <small style={{ color: "#6b7280" }}>请先在供应商Tab选用供应商，然后上传资质</small>}
          </div>
        </>
      )}
      {activeSubTab === "compliance" && (
        <>
          <ComplianceChecklist category={templateId} />
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <h5 style={{ fontSize: 13, margin: 0 }}>📎 合规证据上传 · P1-1</h5>
            {["sc", "label", "test"].map(id => (
              <ComplianceEvidenceManager
                key={id}
                complianceItem={{ id, label: id === "sc" ? "SC许可" : id === "label" ? "标签审核" : "出厂检验", description: "合规项", required: true, category: templateId } as any}
                evidences={[]}
                onUpload={() => {}}
                onDelete={() => {}}
              />
            ))}
          </div>
        </>
      )}
      {activeSubTab === "prompts" && (
        <KernPromptLibrary />
      )}
      {activeSubTab === "html" && (
        <CostHtmlReportRich
          category={templateId}
          productName={`${templateId}产品`}
          result={result}
          bomItems={bomItemsState}
          supplierQuotes={supplierQuotesState}
          complianceItems={[]}
        />
      )}
      {activeSubTab === "scenario" && (
        <CostScenarioManager
          currentScenario={{
            category: templateId,
            productName: `${templateId}产品`,
            moduleValues: values,
            bomItems: bomItemsState,
            supplierQuotes: supplierQuotesState,
            complianceItems: [],
            totalMaterialCost: result?.breakdown.totalMaterial || 0,
            totalManufacturingCost: result?.breakdown.totalManufacturing || 0,
            totalPackagingCost: result?.breakdown.totalPackaging || 0,
            totalLogisticsCost: result?.breakdown.totalLogistics || 0,
            totalComplianceCost: result?.breakdown.totalCompliance || 0,
            totalChannelCost: result?.breakdown.totalChannel || 0,
            totalCost: result?.breakdown.totalCost || 0,
            suggestedRetailPrice: result?.breakdown.totalCost ? result.breakdown.totalCost * 2.5 : 0,
            profitMargin: 0.35,
          }}
          onLoad={(s) => {
            setValues(s.moduleValues);
            setTemplateId(s.category);
          }}
        />
      )}

      {activeSubTab === "cost" && (
        <>
          {role === "leadership" ? (
        <div className="cost-leadership">
          <div className="kpi-grid">
            <div className="kpi ok"><span>💰 总成本</span><strong>¥{result.totalCost.toFixed(2)}</strong><small>单件</small></div>
            <div className="kpi brand"><span>📈 零售价</span><strong>¥{result.retailPrice.toFixed(2)}</strong><small>含税</small></div>
            <div className="kpi warn"><span>💹 净利润</span><strong>¥{result.netProfit.toFixed(2)}</strong><small>{result.netMarginRate.toFixed(1)}% 净利率</small></div>
            <div className="kpi bad"><span>📦 盈亏平衡</span><strong>{result.breakevenUnits}</strong><small>件/月</small></div>
          </div>
          <div className="cost-summary">
            <h4>💡 一句话结论 · {template.name}</h4>
            <p>
              {template.id === "regular_food" && `普通食品总成本 ¥${result.totalCost.toFixed(2)}，零售价 ¥${result.retailPrice.toFixed(2)}，净利率 ${result.netMarginRate.toFixed(1)}%，成本较低，重点在原料和包装。`}
              {template.id === "health_food" && `保健食品总成本 ¥${result.totalCost.toFixed(2)}，含备案摊销，零售价 ¥${result.retailPrice.toFixed(2)}，净利率 ${result.netMarginRate.toFixed(1)}%，${result.netMarginRate > 25 ? "利润良好，备案费已摊" : "需优化"}。`}
              {template.id === "cross_border_food" && `跨境食品总成本 ¥${result.totalCost.toFixed(2)}，含国际物流+关税，零售价 ¥${result.retailPrice.toFixed(2)}，净利率 ${result.netMarginRate.toFixed(1)}%，关税和清关是关键。`}
              {template.id === "cosmetics" && `化妆品总成本 ¥${result.totalCost.toFixed(2)}，包材和检测占比较高，零售价 ¥${result.retailPrice.toFixed(2)}，净利率 ${result.netMarginRate.toFixed(1)}%，${result.netMarginRate > 30 ? "利润空间大" : "需优化包材"}。`}
            </p>
            <small>📋 合规：{catInfo.compliance}</small>
          </div>
          <div className="cost-modules-lead">
            {result.modules.slice(0, 4).map(m => (
              <div key={m.moduleId} className="mod-card"><span>{m.icon}</span><strong>{m.label}</strong><span>¥{m.cost.toFixed(2)}</span></div>
            ))}
          </div>
        </div>
      ) : role === "product" ? (
        <div className="cost-product">
          <div className="modules-grid">
            {template.modules.map(modInst => {
              const def = COST_MODULE_REGISTRY[modInst.moduleId];
              if (!def) return null;
              const modValues = values[modInst.moduleId] || {};
              const modResult = result.modules.find(m => m.moduleId === modInst.moduleId);
              return (
                <div key={modInst.moduleId} className={`module-card ${modInst.enabled ? "enabled" : "disabled"}`}>
                  <div className="module-h">
                    <div className="module-title"><span className="icon">{def.icon}</span><strong>{def.label}</strong><small>{def.description}</small></div>
                    <label className="toggle"><input type="checkbox" checked={modInst.enabled} onChange={() => toggleModule(modInst.moduleId)} /><span>启用</span></label>
                  </div>
                  {modInst.enabled && (
                    <>
                      <div className="fields-grid">
                        {def.fields.map(field => (
                          <label key={field.key} className="field">
                            <span>{field.label} {field.required && <i>*</i>} <small>({field.unit})</small></span>
                            {field.type === "select" ? (
                              <select value={String(modValues[field.key] ?? field.defaultValue ?? "")} onChange={e => updateField(modInst.moduleId, field.key, e.target.value)}>
                                {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            ) : (
                              <input type="number" step={field.step || "0.01"} value={modValues[field.key] ?? ""} placeholder={String(field.defaultValue ?? "")} onChange={e => updateField(modInst.moduleId, field.key, e.target.value)} />
                            )}
                            {field.hint && <small className="hint">{field.hint}</small>}
                          </label>
                        ))}
                      </div>
                      {modResult && (
                        <div className="module-result">
                          <strong>小计：¥{modResult.cost.toFixed(2)}</strong>
                          {modResult.breakdown && <div className="breakdown">{Object.entries(modResult.breakdown).map(([k,v]) => <span key={k}>{k}: ¥{Number(v).toFixed(2)}</span>)}</div>}
                          {modResult.notes?.map((n,i) => <small key={i} className="note">⚠️ {n}</small>)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cost-result-full">
            <h3>📊 成本汇总 · {template.name} (专业严谨)</h3>
            <div className="result-table">
              <div className="row"><span>原料/配方</span><strong>¥{result.totalMaterialCost.toFixed(2)}</strong></div>
              <div className="row"><span>制造/剂型</span><strong>¥{result.totalManufacturingCost.toFixed(2)}</strong></div>
              <div className="row"><span>包装/瓶罐</span><strong>¥{result.totalPackagingCost.toFixed(2)}</strong></div>
              <div className="row"><span>物流/国际+关税</span><strong>¥{result.totalLogisticsCost.toFixed(2)}</strong></div>
              <div className="row"><span>渠道费用</span><strong>¥{result.totalChannelCost.toFixed(2)}</strong></div>
              <div className="row"><span>合规/检测/备案摊销</span><strong>¥{(result.modules.find(m => m.moduleId === "compliance")?.cost || 0 + (result.modules.find(m => m.moduleId === "certification")?.cost || 0)).toFixed(2)}</strong></div>
              <div className="row total"><span>总成本</span><strong>¥{result.totalCost.toFixed(2)}</strong></div>
              <div className="row"><span>零售价</span><strong>¥{result.retailPrice.toFixed(2)}</strong></div>
              <div className="row profit"><span>净利润</span><strong>¥{result.netProfit.toFixed(2)} ({result.netMarginRate.toFixed(1)}%)</strong></div>
              <div className="row"><span>保底供货价</span><strong>¥{result.supplyPriceFloor.toFixed(2)}</strong></div>
              <div className="row"><span>建议供货价</span><strong>¥{result.supplyPriceSuggested.toFixed(2)}</strong></div>
            </div>
            <small style={{ color: "#6b7280" }}>📋 {template.name}合规：{catInfo.compliance} · {catInfo.notes}</small>
          </div>
        </div>
      ) : (
        <div className="cost-sales">
          <div className="sales-hero">
            <span className="badge">💰 {template.name} · 销售视角 · 利润空间</span>
            <h2>成本 ¥{result.totalCost.toFixed(2)} → 零售 ¥{result.retailPrice.toFixed(2)}，利润 ¥{result.netProfit.toFixed(2)}</h2>
            <p>净利率 {result.netMarginRate.toFixed(1)}% · {template.id === "cosmetics" ? "化妆品包材和功效是卖点" : template.id === "health_food" ? "保健食品蓝帽子和功能是卖点" : template.id === "cross_border_food" ? "进口/跨境是卖点" : "普通食品性价比是卖点"} · 竞品均价299元</p>
          </div>

          <div className="sales-points">
            <div className="point"><span className="icon">💎</span><div><strong>成本优势</strong><small>{template.name}总成本仅 ¥{result.totalCost.toFixed(2)}，{template.id === "cross_border_food" ? "含关税和国际物流" : template.id === "cosmetics" ? "含包材和检测" : "含备案摊销"}，远低于竞品</small></div></div>
            <div className="point"><span className="icon">📈</span><div><strong>利润空间</strong><small>净利率 {result.netMarginRate.toFixed(1)}%，建议供货价 ¥{result.supplyPriceSuggested.toFixed(2)}，{template.id === "cosmetics" ? "化妆品利润空间大" : "利润良好"}</small></div></div>
            <div className="point"><span className="icon">🎯</span><div><strong>定价策略</strong><small>保底 ¥{result.supplyPriceFloor.toFixed(2)}，建议 ¥{result.supplyPriceSuggested.toFixed(2)}，竞品299元，{catInfo.compliance}已合规</small></div></div>
          </div>

          <div className="cost-modules-sales">
            {result.modules.filter(m => ["material", "packaging", "channel", "compliance"].includes(m.moduleId)).slice(0, 4).map(m => (
              <div key={m.moduleId} className="mod-card-sales"><span>{m.icon}</span><div><strong>{m.label}: ¥{m.cost.toFixed(2)}</strong><small>客户价值：{template.id === "cosmetics" ? "包材和功效突出" : template.id === "health_food" ? "蓝帽子+功能" : "成本可控，利润空间大"}</small></div></div>
            ))}
          </div>

          <div className="sales-tools">
            <h4>💼 销售工具箱 · {template.name}</h4>
            <div className="tool-grid">
              <button className="primary">📽️ 生成报价PPT</button>
              <button>📝 成本话术</button>
              <button>💰 报价单</button>
              <button>📊 利润分析</button>
            </div>
            <div className="script">
              <h4>💬 推荐话术 · {template.name}</h4>
              <p>“{productName || "产品"}({template.name})总成本仅 ¥{result.totalCost.toFixed(2)}，{catInfo.compliance}已合规，零售价 ¥{result.retailPrice.toFixed(2)}，净利率 {result.netMarginRate.toFixed(1)}%，竞品均价299元，利润空间大，建议供货价 ¥{result.supplyPriceSuggested.toFixed(2)}。”</p>
            </div>
          </div>
        </div>
      )}

        </>
      )}

      {result && (
        <>
          <CostExport result={result} category={templateId} bomItems={bomItemsState} supplierQuotes={supplierQuotesState} />
          <CostOfficeExport category={templateId} productName={`${templateId}产品`} result={result} bomItems={bomItemsState} supplierQuotes={supplierQuotesState} complianceItems={[]} />
        </>
      )}
      <div className="cost-actions">
        <button className="primary" onClick={() => onSave?.(result, template)}>💾 保存{template.name}成本方案</button>
        <button>📤 导出Excel</button>
        <button>📊 生成对比</button>
        <button>📋 {catInfo.compliance}</button>
      </div>
    </div>
    </CostCalculatorPerformance>
  );
}
