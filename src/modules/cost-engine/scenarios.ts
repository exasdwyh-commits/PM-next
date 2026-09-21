/**
 * 成本情景管理（TASK-011）
 *
 * - saveCostScenario: 保存前服务器 calcCost() 复算，记录引擎版本、来源状态、单位/币种/费用基数
 * - listCostScenarios: 按 workItemId 查询已保存的成本情景
 * - compareCostScenarios: 对比两个情景的差异
 *
 * 写入落 COST_SCENARIO 结构化成果（复用既有 Artifact 路径 + writeStructuredArtifact）
 */
import { Prisma, ProducerType } from "@prisma/client";
import { calcCost } from "./index";
import type { CostInput, CostResult } from "./types";
import { writeStructuredArtifact, ArtifactWriteClient } from "../work/structured-artifacts";
import { ARTIFACT_SCHEMA_VERSION } from "../work/artifact-schema";

/** 成本情景引擎版本（每次复算逻辑变更时递增） */
export const COST_ENGINE_VERSION = "1.0";

export interface SaveCostScenarioParams {
  workItemId: string;
  productVersionId?: string | null;
  scenarioName: string;
  costInput: CostInput;
  sourceStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
  unit: string;
  currency: string;
  expenseBase: string;
  recordedBy: string;
  organizationId: string;
  submissionId?: string | null;
  evidenceRefs?: unknown;
}

export interface CostScenarioRecord {
  artifactId: string;
  scenarioName: string;
  costInput: CostInput;
  recalculatedResult: CostResult;
  sourceStatus: string;
  unit: string;
  currency: string;
  expenseBase: string;
  engineVersion: string;
  recordedBy: string;
  contentVersion: number;
}

/**
 * 保存成本情景。
 *
 * 1. 服务器端 calcCost() 复算（不信任客户端结果）
 * 2. 构建 COST_SCENARIO 结构化成果
 * 3. 通过 writeStructuredArtifact 追加保存到 Artifact 行
 */
export async function saveCostScenario(
  tx: ArtifactWriteClient,
  params: SaveCostScenarioParams
): Promise<CostScenarioRecord> {
  const recalculatedResult = calcCost(params.costInput);

  const businessInput: Record<string, unknown> = {
    engineVersion: COST_ENGINE_VERSION,
    scenarioName: params.scenarioName,
    currency: params.currency,
    unit: params.unit,
    expenseBase: params.expenseBase,
    sourceStatus: params.sourceStatus,
    costInput: params.costInput,
    result: recalculatedResult.totalCost,
    netProfit: recalculatedResult.netProfit,
    netMarginRate: recalculatedResult.netMarginRate,
    bomMarginRate: recalculatedResult.bomMarginRate,
    breakevenUnits: recalculatedResult.breakevenUnits,
    alerts: recalculatedResult.alerts,
  };

  const artifact = await writeStructuredArtifact(tx, {
    type: "COST_SCENARIO",
    title: params.scenarioName,
    workItemId: params.workItemId,
    submissionId: params.submissionId ?? null,
    inputRevision: 1,
    businessInput,
    envelope: {
      organizationId: params.organizationId,
      productVersionId: params.productVersionId ?? null,
      sourceRefs: [],
      dataNature: "REAL",
      assumptions: [],
      missingInputs: [],
      recordedBy: params.recordedBy,
    },
    producerType: ProducerType.MANUAL,
    evidenceRefs: params.evidenceRefs,
  });

  return {
    artifactId: artifact.id,
    scenarioName: params.scenarioName,
    costInput: params.costInput,
    recalculatedResult,
    sourceStatus: params.sourceStatus,
    unit: params.unit,
    currency: params.currency,
    expenseBase: params.expenseBase,
    engineVersion: COST_ENGINE_VERSION,
    recordedBy: params.recordedBy,
    contentVersion: artifact.contentVersion,
  };
}

/**
 * 从 Artifact 行解析成本情景记录
 */
export function parseCostScenario(artifact: {
  id: string;
  content: string;
  schemaVersion: string | null;
  contentVersion: number;
}): CostScenarioRecord | null {
  if (artifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  if (obj.engineVersion !== COST_ENGINE_VERSION) return null;

  return {
    artifactId: artifact.id,
    scenarioName: String(obj.scenarioName ?? ""),
    costInput: (obj.costInput as CostInput) ?? ({} as CostInput),
    recalculatedResult: {
      totalCost: Number(obj.result ?? 0),
      netProfit: Number(obj.netProfit ?? 0),
      netMarginRate: Number(obj.netMarginRate ?? 0),
      bomMarginRate: Number(obj.bomMarginRate ?? 0),
      breakevenUnits: Number(obj.breakevenUnits ?? 0),
      alerts: Array.isArray(obj.alerts) ? obj.alerts : [],
    } as CostResult,
    sourceStatus: String(obj.sourceStatus ?? "DRAFT"),
    unit: String(obj.unit ?? ""),
    currency: String(obj.currency ?? ""),
    expenseBase: String(obj.expenseBase ?? ""),
    engineVersion: String(obj.engineVersion ?? COST_ENGINE_VERSION),
    recordedBy: "",
    contentVersion: artifact.contentVersion,
  };
}

/**
 * 按 productVersionId 查询已保存的成本情景
 */
export async function listCostScenarios(
  client: { artifact: { findMany: (args: any) => Promise<any[]> } },
  productVersionId: string
): Promise<Array<{ id: string; content: string; schemaVersion: string | null; contentVersion: number; title: string }>> {
  return client.artifact.findMany({
    where: {
      productVersionId,
      type: "COST_SCENARIO",
    },
    select: {
      id: true,
      content: true,
      schemaVersion: true,
      contentVersion: true,
      title: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface ScenarioDiffField {
  field: string;
  label: string;
  left: unknown;
  right: unknown;
}

/**
 * 对比两个成本情景的差异
 */
export function compareCostScenarios(
  left: CostScenarioRecord,
  right: CostScenarioRecord
): ScenarioDiffField[] {
  const diffs: ScenarioDiffField[] = [];
  const fields: Array<{ key: string; label: string }> = [
    { key: "scenarioName", label: "情景名称" },
    { key: "sourceStatus", label: "来源状态" },
    { key: "unit", label: "单位" },
    { key: "currency", label: "币种" },
    { key: "expenseBase", label: "费用基数" },
  ];

  for (const f of fields) {
    const lv = (left as Record<string, unknown>)[f.key];
    const rv = (right as Record<string, unknown>)[f.key];
    if (lv !== rv) {
      diffs.push({ field: f.key, label: f.label, left: lv, right: rv });
    }
  }

  const resultFields: Array<{ key: keyof CostResult; label: string }> = [
    { key: "totalCost", label: "总成本" },
    { key: "netProfit", label: "净利润" },
    { key: "netMarginRate", label: "净利率" },
    { key: "bomMarginRate", label: "BOM毛利率" },
    { key: "breakevenUnits", label: "盈亏平衡量" },
  ];

  for (const f of resultFields) {
    const lv = left.recalculatedResult[f.key];
    const rv = right.recalculatedResult[f.key];
    if (lv !== rv) {
      diffs.push({ field: f.key, label: f.label, left: lv, right: rv });
    }
  }

  return diffs;
}
