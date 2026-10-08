/** 成本方案保存 - 4类专用 - P0-1 后端持久化 + localStorage fallback */
import type { BomItem } from "./bom-import";
import type { SupplierQuote } from "./supplier-quote";
import type { ComplianceItem } from "./compliance-checklist";

export interface CostScenario {
  id: string;
  name: string;
  category: "regular_food" | "health_food" | "cross_border_food" | "cosmetics" | string;
  productName: string;
  projectId?: string | null;
  status?: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "ARCHIVED" | string;
  createdAt: string;
  updatedAt: string;
  // 核心数据
  moduleValues: Record<string, Record<string, number>>;
  bomItems: BomItem[];
  supplierQuotes: SupplierQuote[];
  complianceItems: ComplianceItem[];
  // 计算结果快照
  totalMaterialCost: number;
  totalManufacturingCost: number;
  totalPackagingCost: number;
  totalLogisticsCost: number;
  totalComplianceCost: number;
  totalChannelCost: number;
  totalCost: number;
  suggestedRetailPrice: number;
  profitMargin: number;
  // 备注
  notes?: string;
  tags?: string[];
  isFavorite?: boolean;
  // 后端扩展
  organizationId?: string;
  createdBy?: string;
}

export const SCENARIO_STORAGE_KEY = "cost_scenarios_v2";

// ── localStorage fallback ──
export function saveScenarioLocal(scenario: CostScenario): CostScenario[] {
  const all = loadScenariosLocal();
  const idx = all.findIndex(s => s.id === scenario.id);
  const now = new Date().toISOString();
  const toSave = { ...scenario, updatedAt: now, createdAt: scenario.createdAt || now };
  if (idx >= 0) {
    all[idx] = toSave;
  } else {
    all.push(toSave);
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(all));
  }
  return all;
}

export function loadScenariosLocal(): CostScenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CostScenario[];
  } catch {
    return [];
  }
}

// 兼容旧API
export const saveScenario = saveScenarioLocal;
export const loadScenarios = loadScenariosLocal;

export function deleteScenarioLocal(id: string): CostScenario[] {
  const all = loadScenariosLocal().filter(s => s.id !== id);
  if (typeof window !== "undefined") {
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(all));
  }
  return all;
}

export const deleteScenario = deleteScenarioLocal;

export function duplicateScenarioLocal(id: string): CostScenario | null {
  const all = loadScenariosLocal();
  const orig = all.find(s => s.id === id);
  if (!orig) return null;
  const copy: CostScenario = {
    ...orig,
    id: `scenario-${Date.now()}`,
    name: `${orig.name} 副本`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveScenarioLocal(copy);
  return copy;
}

export const duplicateScenario = duplicateScenarioLocal;

export function compareScenariosLocal(ids: string[]): { scenarios: CostScenario[]; comparison: Record<string, { min: number; max: number; avg: number }> } {
  const all = loadScenariosLocal();
  const selected = all.filter(s => ids.includes(s.id));
  if (selected.length === 0) return { scenarios: [], comparison: {} };
  
  const metrics = ["totalMaterialCost", "totalManufacturingCost", "totalPackagingCost", "totalLogisticsCost", "totalComplianceCost", "totalChannelCost", "totalCost", "suggestedRetailPrice", "profitMargin"] as const;
  const comparison: Record<string, { min: number; max: number; avg: number }> = {};
  
  metrics.forEach(m => {
    const vals = selected.map(s => (s as any)[m] as number).filter(v => typeof v === "number");
    if (vals.length > 0) {
      comparison[m] = {
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      };
    }
  });
  
  return { scenarios: selected, comparison };
}

export const compareScenarios = compareScenariosLocal;

export function exportScenarioToCsv(scenario: CostScenario): string {
  const lines = [
    `方案名称,${scenario.name}`,
    `类别,${scenario.category}`,
    `产品,${scenario.productName}`,
    `项目,${scenario.projectId || "-"}`,
    `状态,${scenario.status || "DRAFT"}`,
    `创建时间,${scenario.createdAt}`,
    `原料成本,${scenario.totalMaterialCost.toFixed(2)}`,
    `生产成本,${scenario.totalManufacturingCost.toFixed(2)}`,
    `包装成本,${scenario.totalPackagingCost.toFixed(2)}`,
    `物流成本,${scenario.totalLogisticsCost.toFixed(2)}`,
    `合规成本,${scenario.totalComplianceCost.toFixed(2)}`,
    `渠道成本,${scenario.totalChannelCost.toFixed(2)}`,
    `总成本,${scenario.totalCost.toFixed(2)}`,
    `建议零售价,${scenario.suggestedRetailPrice.toFixed(2)}`,
    `利润率,${(scenario.profitMargin * 100).toFixed(1)}%`,
    ``,
    `BOM清单`,
    `名称,数量,单位,单价,成本,供应商`,
    ...scenario.bomItems.map(item => `${item.name},${item.quantity},${item.unit},${item.unitPrice},${item.cost},${item.supplier || ""}`),
    ``,
    `供应商报价`,
    `产品,供应商,单价,MOQ,交期,类别`,
    ...scenario.supplierQuotes.map(q => `${q.productName},${q.supplierName},${q.unitPrice},${q.moq},${q.leadTime},${q.category}`),
  ];
  return lines.join("\n");
}

export function getScenarioStatsLocal() {
  const all = loadScenariosLocal();
  const byCategory: Record<string, number> = {};
  all.forEach(s => {
    byCategory[s.category] = (byCategory[s.category] || 0) + 1;
  });
  return {
    total: all.length,
    byCategory,
    favorites: all.filter(s => s.isFavorite).length,
    avgCost: all.length > 0 ? all.reduce((sum, s) => sum + s.totalCost, 0) / all.length : 0,
  };
}

export const getScenarioStats = getScenarioStatsLocal;

// ── 后端API - P0-1 ──

export async function saveScenarioApi(scenario: Partial<CostScenario> & { name: string; productName: string }): Promise<CostScenario> {
  const res = await fetch("/api/cost/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save scenario");
  }
  const data = await res.json();
  return data.scenario;
}

export async function loadScenariosApi(params?: { projectId?: string; category?: string; status?: string; favorite?: boolean }): Promise<{ scenarios: CostScenario[]; stats: any }> {
  const search = new URLSearchParams();
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.category) search.set("category", params.category);
  if (params?.status) search.set("status", params.status);
  if (params?.favorite) search.set("favorite", "true");

  const res = await fetch(`/api/cost/scenarios?${search.toString()}`);
  if (!res.ok) throw new Error("Failed to load scenarios");
  return res.json();
}

export async function deleteScenarioApi(id: string): Promise<void> {
  const res = await fetch(`/api/cost/scenarios/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete scenario");
}

export async function updateScenarioApi(id: string, data: Partial<CostScenario> & { changeNote?: string }): Promise<CostScenario> {
  const res = await fetch(`/api/cost/scenarios/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update scenario");
  const json = await res.json();
  return json.scenario;
}

export async function compareScenariosApi(ids: string[]): Promise<{ scenarios: CostScenario[]; comparison: any; charts: any; byCategory: any }> {
  const res = await fetch("/api/cost/scenarios/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Failed to compare scenarios");
  return res.json();
}

// 智能保存：优先API，失败fallback到localStorage
export async function saveScenarioSmart(scenario: CostScenario): Promise<CostScenario> {
  try {
    const saved = await saveScenarioApi(scenario);
    // 同时保存到local作为缓存
    saveScenarioLocal(saved);
    return saved;
  } catch (e) {
    console.warn("API save failed, fallback to localStorage:", e);
    const all = saveScenarioLocal(scenario);
    return all.find(s => s.id === scenario.id)!;
  }
}
