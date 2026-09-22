import crypto from "crypto";
import { ProjectMode, ProjectStage } from "@prisma/client";
import { buildArtifactRef, stableStringify, type ArtifactRef } from "../decisions/artifact-ref";
import { readStructuredArtifact } from "../work/structured-artifacts";

export const G2_COMMON_REQUIRED_ARTIFACTS = [
  "SUPPLIER_QUOTE",
  "PROFESSIONAL_CONFIRMATION",
  "PACKAGING_BRIEF",
  "PRODUCTION_PLAN",
] as const;

export type ProductionRequiredArtifactType =
  | (typeof G2_COMMON_REQUIRED_ARTIFACTS)[number]
  | "SAMPLE_ROUND";

export interface ProductionGateCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ProductionArtifactInput {
  id: string;
  type: string;
  title: string;
  content: string;
  contentVersion: number;
  inputRevision: number;
  reviewStatus: string;
  schemaVersion: string | null;
  organizationId: string | null;
  productVersionId: string | null;
  createdAt: Date;
}

export interface ProductionProjectInput {
  id: string;
  organizationId: string;
  mode: ProjectMode | string;
  stage: ProjectStage | string;
  revision: number;
  productVersionId: string | null;
  ownerId: string;
  decisionMakerId: string | null;
  productVersion?: {
    id: string;
    isConfirmed: boolean;
  } | null;
  workItems: Array<{
    artifacts: ProductionArtifactInput[];
  }>;
}

export interface ProductionGateSnapshot {
  ready: boolean;
  checks: ProductionGateCheck[];
  blockers: string[];
  artifactRefs: ArtifactRef[];
  selectedArtifactIds: Record<string, string>;
  budgetAmount: number | null;
  budgetCurrency: string;
  budgetScope: string | null;
  validationPlan: string;
  productionFingerprint: string;
  requiredChecks: Record<string, unknown>;
}

function dateValue(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numberValue(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function currentAcceptedProductionArtifacts(
  project: ProductionProjectInput
): Map<string, ProductionArtifactInput> {
  const currentVersionId = project.productVersionId;
  const rows = project.workItems
    .flatMap((w) => w.artifacts)
    .filter(
      (a) =>
        a.reviewStatus === "ACCEPTED" &&
        a.organizationId === project.organizationId &&
        !!currentVersionId &&
        a.productVersionId === currentVersionId
    )
    .sort((a, b) => {
      const time = b.createdAt.getTime() - a.createdAt.getTime();
      if (time !== 0) return time;
      return b.contentVersion - a.contentVersion || b.id.localeCompare(a.id);
    });

  const selected = new Map<string, ProductionArtifactInput>();
  for (const row of rows) {
    if (!selected.has(row.type)) selected.set(row.type, row);
  }
  return selected;
}

function readBusiness(
  artifact: ProductionArtifactInput,
  checks: ProductionGateCheck[]
): Record<string, unknown> | null {
  if (!artifact.schemaVersion) {
    checks.push({
      key: `structured_${artifact.type}`,
      label: `${artifact.type} 为结构化成果`,
      ok: false,
      detail: `${artifact.type} 仍是自由文本/未版本化成果，不能作为正式 G2 输入`,
    });
    return null;
  }
  try {
    const parsed = readStructuredArtifact({
      type: artifact.type,
      content: artifact.content,
      schemaVersion: artifact.schemaVersion,
    });
    if (parsed.kind !== "structured") {
      checks.push({
        key: `structured_${artifact.type}`,
        label: `${artifact.type} 为结构化成果`,
        ok: false,
        detail: `${artifact.type} 不是可验证的结构化成果`,
      });
      return null;
    }
    if (parsed.value.dataNature !== "REAL") {
      checks.push({
        key: `real_${artifact.type}`,
        label: `${artifact.type} 为真实成果`,
        ok: false,
        detail: `${artifact.type} 的 dataNature 不是 REAL，演示/测试成果不得进入正式 G2`,
      });
      return null;
    }
    const missing = stringArray(parsed.value.missingInputs);
    if (missing.length > 0) {
      checks.push({
        key: `complete_${artifact.type}`,
        label: `${artifact.type} 关键输入完整`,
        ok: false,
        detail: `${artifact.type} 仍有未闭合输入：${missing.join("、")}`,
      });
      return null;
    }
    return parsed.value;
  } catch (error: any) {
    checks.push({
      key: `parse_${artifact.type}`,
      label: `${artifact.type} 可解析`,
      ok: false,
      detail: `${artifact.type} 结构化内容无效：${error?.message ?? "无法解析"}`,
    });
    return null;
  }
}

export function computeProductionFingerprint(input: {
  projectId: string;
  projectRevision: number;
  productVersionId: string | null;
  artifactRefs: ArtifactRef[];
  budgetAmount: number | null;
  budgetCurrency: string;
  budgetScope: string | null;
}): string {
  const payload = {
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    productVersionId: input.productVersionId,
    artifactRefs: [...input.artifactRefs].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
    budgetAmount: input.budgetAmount,
    budgetCurrency: input.budgetCurrency,
    budgetScope: input.budgetScope,
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function evaluateProductionPreparation(
  project: ProductionProjectInput
): { ready: boolean; blockers: string[]; checks: ProductionGateCheck[] } {
  const checks: ProductionGateCheck[] = [];
  checks.push({
    key: "product_version",
    label: "当前产品版本已确认",
    ok: !!project.productVersionId && !!project.productVersion?.isConfirmed,
    detail:
      project.productVersionId && project.productVersion?.isConfirmed
        ? "当前产品版本已确认"
        : "必须先绑定并确认当前产品版本",
  });

  if (project.mode === ProjectMode.NEW_PRODUCT || project.mode === "NEW_PRODUCT") {
    checks.push({
      key: "stage",
      label: "新品已处于打样阶段",
      ok: project.stage === ProjectStage.SAMPLING || project.stage === "SAMPLING",
      detail:
        project.stage === ProjectStage.SAMPLING || project.stage === "SAMPLING"
          ? "新品已处于 SAMPLING"
          : `新品必须先完成 G1 并进入 SAMPLING，当前阶段为 ${project.stage}`,
    });

    const selected = currentAcceptedProductionArtifacts(project);
    const sample = selected.get("SAMPLE_ROUND");
    let samplePass = false;
    if (sample) {
      const tmpChecks: ProductionGateCheck[] = [];
      const parsed = readBusiness(sample, tmpChecks);
      samplePass = parsed?.verdict === "PASS";
    }
    checks.push({
      key: "sample_pass",
      label: "当前版本样品已人工验收 PASS",
      ok: !!sample && samplePass,
      detail: !sample
        ? "缺少当前产品版本、负责人验收通过的 SAMPLE_ROUND"
        : samplePass
          ? "当前样品轮次 verdict=PASS"
          : "当前样品轮次不是 PASS 或结构化内容无效",
    });
  } else {
    checks.push({
      key: "stage",
      label: "固定产品从生产准备阶段开始",
      ok: project.stage === ProjectStage.PRODUCTION_PREP || project.stage === "PRODUCTION_PREP",
      detail:
        project.stage === ProjectStage.PRODUCTION_PREP || project.stage === "PRODUCTION_PREP"
          ? "固定产品已处于 PRODUCTION_PREP"
          : `固定产品应处于 PRODUCTION_PREP，当前阶段为 ${project.stage}`,
    });
  }

  const blockers = checks.filter((x) => !x.ok).map((x) => x.detail);
  return { ready: blockers.length === 0, blockers, checks };
}

export function evaluateProductionGate(
  project: ProductionProjectInput,
  now: Date = new Date()
): ProductionGateSnapshot {
  const checks: ProductionGateCheck[] = [];
  const selected = currentAcceptedProductionArtifacts(project);
  const required: ProductionRequiredArtifactType[] = [
    ...G2_COMMON_REQUIRED_ARTIFACTS,
    ...((project.mode === ProjectMode.NEW_PRODUCT || project.mode === "NEW_PRODUCT")
      ? (["SAMPLE_ROUND"] as const)
      : []),
  ];

  checks.push({
    key: "stage",
    label: "项目处于生产准备阶段",
    ok: project.stage === ProjectStage.PRODUCTION_PREP || project.stage === "PRODUCTION_PREP",
    detail:
      project.stage === ProjectStage.PRODUCTION_PREP || project.stage === "PRODUCTION_PREP"
        ? "项目处于 PRODUCTION_PREP"
        : `正式 G2 只能在 PRODUCTION_PREP 提交，当前阶段为 ${project.stage}`,
  });

  checks.push({
    key: "decision_maker",
    label: "已指定独立决策人",
    ok: !!project.decisionMakerId && project.decisionMakerId !== project.ownerId,
    detail:
      project.decisionMakerId && project.decisionMakerId !== project.ownerId
        ? "已指定独立决策人"
        : "G2 必须指定与负责人不同的决策人",
  });

  checks.push({
    key: "product_version",
    label: "当前产品版本已确认",
    ok: !!project.productVersionId && !!project.productVersion?.isConfirmed,
    detail:
      project.productVersionId && project.productVersion?.isConfirmed
        ? "产品版本已确认"
        : "G2 必须绑定已确认的当前产品版本",
  });

  for (const type of required) {
    checks.push({
      key: `artifact_${type}`,
      label: `已验收 ${type}`,
      ok: selected.has(type),
      detail: selected.has(type)
        ? `已找到当前产品版本的负责人验收成果 ${type}`
        : `缺少当前产品版本且 reviewStatus=ACCEPTED 的 ${type}`,
    });
  }

  const parsed = new Map<string, Record<string, unknown>>();
  for (const type of required) {
    const artifact = selected.get(type);
    if (!artifact) continue;
    const value = readBusiness(artifact, checks);
    if (value) parsed.set(type, value);
  }

  const quote = parsed.get("SUPPLIER_QUOTE");
  if (quote) {
    const validUntil = dateValue(quote.validUntil);
    checks.push({
      key: "quote_valid",
      label: "供应商报价仍在有效期",
      ok: !!validUntil && validUntil.getTime() >= now.getTime(),
      detail:
        validUntil && validUntil.getTime() >= now.getTime()
          ? `报价有效至 ${validUntil.toISOString().slice(0, 10)}`
          : "供应商报价已过期或缺少有效期",
    });
    checks.push({
      key: "quote_quantity",
      label: "报价数量/MOQ 有效",
      ok:
        (numberValue(quote.quantity) ?? 0) > 0 &&
        (numberValue(quote.moq) ?? 0) >= 0 &&
        (numberValue(quote.unitPrice) ?? 0) > 0,
      detail: "报价必须含正数数量、单价及合法 MOQ",
    });
  }

  const sample = parsed.get("SAMPLE_ROUND");
  if (sample) {
    checks.push({
      key: "sample_pass",
      label: "样品结论 PASS",
      ok: sample.verdict === "PASS",
      detail:
        sample.verdict === "PASS"
          ? "负责人验收的当前样品结论为 PASS"
          : `当前样品结论为 ${String(sample.verdict ?? "UNKNOWN")}，不能进入正式生产投入`,
    });
  }

  const professional = parsed.get("PROFESSIONAL_CONFIRMATION");
  if (professional) {
    const validUntil = professional.validUntil ? dateValue(professional.validUntil) : null;
    checks.push({
      key: "professional_valid",
      label: "专业确认仍有效",
      ok: !professional.validUntil || (!!validUntil && validUntil.getTime() >= now.getTime()),
      detail:
        !professional.validUntil
          ? "专业确认未设置失效期"
          : validUntil && validUntil.getTime() >= now.getTime()
            ? `专业确认有效至 ${validUntil.toISOString().slice(0, 10)}`
            : "专业确认已过期",
    });
  }

  const plan = parsed.get("PRODUCTION_PLAN");
  let budgetAmount: number | null = null;
  let budgetCurrency = "CNY";
  let budgetScope: string | null = null;
  let authorizedQuantity: number | null = null;
  let authorizedUnit: string | null = null;
  let validationPlan =
    "正式 G2 生产投入授权：冻结当前产品版本、报价、样品/适用确认、包装、专业确认与生产计划；实际开工另行记录。";

  if (plan) {
    const quantity = numberValue(plan.quantity);
    budgetAmount = numberValue(plan.budget);
    budgetCurrency = typeof plan.currency === "string" ? plan.currency : "CNY";
    const unit = typeof plan.unit === "string" ? plan.unit : "";
    authorizedQuantity = quantity;
    authorizedUnit = unit || null;
    const leadTime = typeof plan.leadTime === "string" ? plan.leadTime : null;
    const productionConditions = stringArray(plan.productionConditions);
    const stopConditions = stringArray(plan.stopConditions);

    checks.push({
      key: "production_plan_amount",
      label: "生产数量与预算为正数",
      ok: (quantity ?? 0) > 0 && (budgetAmount ?? 0) > 0,
      detail:
        (quantity ?? 0) > 0 && (budgetAmount ?? 0) > 0
          ? `计划数量 ${quantity} ${unit}，预算 ${budgetAmount} ${budgetCurrency}`
          : "生产计划必须明确正数数量与预算",
    });

    const refs = {
      quoteRefs: stringArray(plan.quoteRefs),
      sampleRefs: stringArray(plan.sampleRefs),
      packagingRefs: stringArray(plan.packagingRefs),
    };
    const quoteId = selected.get("SUPPLIER_QUOTE")?.id;
    const sampleId = selected.get("SAMPLE_ROUND")?.id;
    const packagingId = selected.get("PACKAGING_BRIEF")?.id;
    checks.push({
      key: "production_plan_refs",
      label: "生产计划引用当前权威输入",
      ok:
        (!!quoteId && refs.quoteRefs.includes(quoteId)) &&
        (!!packagingId && refs.packagingRefs.includes(packagingId)) &&
        ((project.mode === ProjectMode.NEW_PRODUCT || project.mode === "NEW_PRODUCT")
          ? !!sampleId && refs.sampleRefs.includes(sampleId)
          : true),
      detail: "生产计划必须明确引用当前报价、包装，以及新品对应的 PASS 样品",
    });

    checks.push({
      key: "production_conditions",
      label: "生产与停止条件已明确",
      ok: productionConditions.length > 0 && stopConditions.length > 0,
      detail:
        productionConditions.length > 0 && stopConditions.length > 0
          ? "生产条件与停止条件均已明确"
          : "生产计划必须同时明确 productionConditions 与 stopConditions",
    });

    budgetScope = [
      `数量 ${quantity ?? "UNKNOWN"} ${unit || "UNKNOWN"}`,
      leadTime ? `交期 ${leadTime}` : "交期未明确",
      `生产条件 ${productionConditions.join("、") || "未明确"}`,
      `停止条件 ${stopConditions.join("、") || "未明确"}`,
    ].join("；");
    validationPlan = `${validationPlan} 执行条件：${budgetScope}`;
  }

  const blockers = checks.filter((x) => !x.ok).map((x) => x.detail);
  const artifactRefs = required
    .map((type) => selected.get(type))
    .filter((x): x is ProductionArtifactInput => !!x)
    .map(buildArtifactRef)
    .sort((a, b) => a.type.localeCompare(b.type));

  const productionFingerprint = computeProductionFingerprint({
    projectId: project.id,
    projectRevision: project.revision,
    productVersionId: project.productVersionId,
    artifactRefs,
    budgetAmount,
    budgetCurrency,
    budgetScope,
  });

  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    artifactRefs,
    selectedArtifactIds: Object.fromEntries(
      [...selected.entries()].map(([type, artifact]) => [type, artifact.id])
    ),
    budgetAmount,
    budgetCurrency,
    budgetScope,
    validationPlan,
    productionFingerprint,
    requiredChecks: {
      productionGateReady: blockers.length === 0,
      productionGateChecks: checks,
      inputBaselineRevision: project.revision,
      productionArtifactIds: Object.fromEntries(
        artifactRefs.map((ref) => [ref.type, ref.id])
      ),
      productionAuthorization: {
        quantity: authorizedQuantity,
        unit: authorizedUnit,
        budget: budgetAmount,
        currency: budgetCurrency,
      },
      productionFingerprint,
    },
  };
}
