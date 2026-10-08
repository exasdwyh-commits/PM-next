/**
 * 运营成本核算与供货定价模块 — 计算引擎统一入口
 * 4类专用：普通食品、保健食品、跨境食品、化妆品
 */

import type { CostInput, CostResult } from './types'
import { calcFreight } from './freight'
import { calcChannelCost } from './channel'
import { calcTotalCost } from './cost-total'
import { calcTax } from './tax'
import { calcSupplyPrice } from './supply-price'
import { calcProfitMetrics } from './profit-metrics'
import { calcBudgetVariance } from './budget-variance'
import { checkCost } from './self-check'

export function calcCost(input: CostInput): CostResult {
  const freight = calcFreight(input)
  const channel = calcChannelCost(input)
  const totalCost = calcTotalCost(input, { freight, channel })
  const tax = calcTax(input, { freight, channel, totalCost })
  const supplyPrice = calcSupplyPrice(input, { totalCost: totalCost.totalCost })
  const profitMetrics = calcProfitMetrics(input, { totalCost, tax })
  const budgetVariance = calcBudgetVariance(input, { totalCost })
  const freightExclVat = freight.baseFreight
  const result: CostResult = {
    ...totalCost,
    ...tax,
    ...profitMetrics,
    ...supplyPrice,
    ...budgetVariance,
    purchaseCostExclVat: totalCost.purchaseCostExclVat,
    freightExclVat,
    alerts: [],
  }
  result.alerts = checkCost(input, result)
  return result
}

// ── 重导出常用 API ─────────────────────────────────────
export * from './types'
export { calcFreight } from './freight'
export { calcChannelCost } from './channel'
export { calcTotalCost } from './cost-total'
export { calcTax } from './tax'
export { calcSupplyPrice } from './supply-price'
export { calcProfitMetrics } from './profit-metrics'
export { calcBudgetVariance } from './budget-variance'
export { runSelfCheck, checkCost } from './self-check'
export {
  CHANNEL_PRESETS,
  CATEGORY_TARGET_MARGIN,
  applyDefaults,
  applyChannelPreset,
  DEFAULT_FREIGHT_BASE,
  DEFAULT_COLD_CHAIN_EXTRA,
  DEFAULT_GOODS_VAT_RATE,
  DEFAULT_SERVICE_VAT_RATE,
  DEFAULT_SURTAX_RATE,
  DEFAULT_INCOME_TAX_RATE,
  DEFAULT_TARGET_MARGIN_RATE,
  DEFAULT_PRICING_STRATEGY,
} from './presets'

// ── 模块化成本 4类专用 ──
export { calculateModularCost, calculateCostForProduct } from './modules/calculator';
export { COST_MODULE_REGISTRY, getModuleDef, listModules } from './modules/registry';
export { COST_TEMPLATES, getTemplate, listTemplates, getTemplateForProduct } from './templates';
export type { CostModuleDef, ProductCostTemplate, ModularCostResult } from './modules/types';

// ── BOM导入 ──
export { calculateBomCost, parseBomCsv, getBomTemplate, BOM_TEMPLATES } from './bom-import';
export type { BomItem, BomImportResult } from './bom-import';

// ── 供应商报价 ──
export { compareSupplierQuotes, groupQuotesByProduct, getSupplierTemplate, SUPPLIER_TEMPLATES, calculateBomFromQuotes } from './supplier-quote';
export type { SupplierQuote, SupplierComparison } from './supplier-quote';

// ── 合规清单 ──
export { getComplianceChecklist, calculateComplianceCost, getComplianceForRole, COMPLIANCE_CHECKLISTS } from './compliance-checklist';
export type { ComplianceItem } from './compliance-checklist';

// ── 成本方案保存 ──
export { saveScenario, loadScenarios, deleteScenario, duplicateScenario, compareScenarios, exportScenarioToCsv, getScenarioStats } from './scenario';
export type { CostScenario } from './scenario';

// ── HTML可视化报告 Claude风格 + Harness ──
export { costResultToEnvelope, generateCostHtmlReport } from './html-report';
export type { HtmlReportInput } from './html-report';

// ── 富可视化HTML报告 Kern完美结合 15组件+8动效 ──
export { costResultToRichEnvelope, generateRichHtmlReport } from './html-report-rich';
export type { RichHtmlReportInput } from './html-report-rich';

// ── 国际化 P3-3 ──
export { t, getCategoryI18n, getLocale, setLocale, shouldShowBilingual, isCrossBorderCategory } from './i18n';
export type { Locale, I18nText } from './i18n';
