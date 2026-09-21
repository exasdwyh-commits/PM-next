import crypto from "crypto";
import { UnprocessableEntityError } from "@/shared/errors";

export interface ScopeHashInput {
  projectId: string;
  gate: string;
  productVersionId?: string | null;
  /** 允许携带 id / contentHash / inputRevision 等扩展字段，但只有 type 与 version 参与指纹 */
  artifactVersions: Array<{ type: string; version: number }>;
  evidenceVersions: Array<{ id: string; hash: string }>;
  budgetAmount?: number | string | null;
  budgetCurrency?: string;
  budgetScope?: string | null;
  validationPlan: string;
}

export function computeScopeHash(input: ScopeHashInput): string {
  // D-018：范围指纹不允许缺省。这里**刻意响亮失败**（抛 422），绝不静默当空数组：
  // 静默兜底会产出一个「覆盖空范围」的指纹 —— 而 scopeHash 是批准有效性的绑定依据
  // （见 version-fingerprint / valid-approval），指纹错了会让批准被错误复用。
  // 宁可让调用方显式声明范围而失败，也不要给出一枚看似合法、实则空范围的指纹。
  if (!Array.isArray(input.artifactVersions)) {
    throw new UnprocessableEntityError("artifactVersions 必须是数组（决策范围指纹不允许缺省）");
  }
  if (!Array.isArray(input.evidenceVersions)) {
    throw new UnprocessableEntityError("evidenceVersions 必须是数组（决策范围指纹不允许缺省）");
  }

  // 1. Sort artifact versions deterministically (C01: 只取类型与精确版本参与指纹)
  const sortedArtifacts = [...input.artifactVersions]
    .map((a) => ({ type: a.type, version: a.version }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.version - b.version);

  // 2. Sort evidence versions deterministically
  const sortedEvidences = [...input.evidenceVersions].sort((a, b) =>
    a.id.localeCompare(b.id) || a.hash.localeCompare(b.hash)
  );

  // 3. Construct canonical representation
  const canonical = {
    projectId: input.projectId,
    gate: input.gate,
    productVersionId: input.productVersionId || null,
    artifacts: sortedArtifacts,
    evidences: sortedEvidences,
    budgetAmount: input.budgetAmount ? String(input.budgetAmount) : null,
    budgetCurrency: input.budgetCurrency || "CNY",
    budgetScope: (input.budgetScope || "").trim(),
    validationPlan: (input.validationPlan || "").trim(),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

/**
 * FINGER-PRINT DIFF（移植自老版 version-fingerprint.ts 的 diffFingerprintDetail 思路）
 * 对比「决策包冻结时的范围快照」与「当前权威状态的范围快照」，
 * 输出人可读的变化维度列表，用于提示"旧批准/旧快照因哪些字段变更而失效"。
 * 任一输入存在 null 或无对应快照时返回 []（不臆断）。
 */
export function diffScopeInput(
  a: Partial<ScopeHashInput> | null | undefined,
  b: Partial<ScopeHashInput> | null | undefined
): string[] {
  if (!a || !b) return [];
  const changes: string[] = [];

  if (String(a.projectId ?? "") !== String(b.projectId ?? "")) changes.push("项目");
  if (String(a.gate ?? "") !== String(b.gate ?? "")) changes.push("决策门");

  const aPV = String(a.productVersionId ?? "");
  const bPV = String(b.productVersionId ?? "");
  if (aPV !== bPV) changes.push("产品版本");

  // artifactVersions: 按 类型/版本 规范化对比
  const normArt = (arr: any) =>
    ((arr || []) as Array<{ type: string; version: number }>)
      .map((x) => `${x.type}:${x.version}`)
      .sort()
      .join(",");
  if (normArt(a.artifactVersions) !== normArt(b.artifactVersions)) {
    changes.push("成果基线");
  }

  // evidenceVersions: 按 id/hash 规范化对比
  const normEv = (arr: any) =>
    ((arr || []) as Array<{ id: string; hash: string }>)
      .map((x) => `${x.id}:${x.hash}`)
      .sort()
      .join(",");
  if (normEv(a.evidenceVersions) !== normEv(b.evidenceVersions)) {
    changes.push("证据集");
  }

  const aBudget = a.budgetAmount == null ? "" : String(a.budgetAmount) + (a.budgetCurrency ?? "");
  const bBudget = b.budgetAmount == null ? "" : String(b.budgetAmount) + (b.budgetCurrency ?? "");
  if (aBudget !== bBudget) changes.push("预算金额/币种");
  if (String(a.budgetScope ?? "") !== String(b.budgetScope ?? "")) changes.push("预算范围");
  if (String(a.validationPlan ?? "") !== String(b.validationPlan ?? "")) changes.push("验证计划");

  return changes;
}
