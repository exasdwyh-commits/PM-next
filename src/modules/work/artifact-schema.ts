/**
 * 成果内容 schema 版本（契约 §4.3，2026-09-16）
 *
 * `Artifact.content` 是**字符串**：结构化成果在其中存 JSON，顶层必须含 `schemaVersion`。
 * `Artifact.schemaVersion` 列（I-003）是同一事实的**可查询副本** —— 只在 JSON 里则
 * 无法按版本批量处理历史数据。写入方必须让两者一致：列 = 常量，JSON 顶层同值。
 *
 * 版本规则（契约 §4.3）：
 *   1. `schemaVersion` 必须置顶；解析方先读它，**未知版本必须拒绝解析并报 422**，
 *      不得「尽力猜」。
 *   2. 结构变更加版本号，不复用旧号；历史数据不回溯改写。
 *
 * 注意：`Artifact.content` 对**非结构化成果**（实验报告、研究叙述等自由文本）仍可为纯文本。
 * 这类成果不声称任何 schema 版本，`schemaVersion` 保持 `null`（= 未版本化），
 * 而不是填一个看起来整齐的默认值 —— 与本项目「未知即未知」一致。
 */
export const ARTIFACT_SCHEMA_VERSION = "1.0";

/**
 * 结构化成果注册表（TASK-009a；契约「结构化成果与门禁契约 A/B 节」＝计划 §1.7）
 *
 * 目的：把「哪些成果类型是结构化的」「每种类型至少要有哪些业务字段」变成**声明式**事实，
 * 由 `structured-artifacts.ts` 统一校验，避免每个写入点各写一套 `if`。
 *
 * 与 §4.2 既有注册表的关系：既有注册表描述**全部**成果类型（含自由文本历史成果）；
 * 本表只登记**新结构化类型**。未登记类型调用结构化写入 helper **必须被拒绝**（不猜、不放行）。
 *
 * 公开信封字段（每种结构化成果都必须有）见 `STRUCTURED_ENVELOPE_FIELDS`，逐条对应契约 A 节。
 */
export const STRUCTURED_ENVELOPE_FIELDS = [
  "schemaVersion",
  "organizationId",
  "sourceRefs",
  "inputFingerprint",
  "dataNature",
  "assumptions",
  "missingInputs",
  "recordedBy",
  "confirmedBy",
  "confirmedAt",
] as const;

/** 公共信封里可空的产品/项目关联（公司级成果允许为空；项目级成果由 scope 要求必填）。 */
export const STRUCTURED_LINK_FIELDS = ["projectId", "productId", "productVersionId"] as const;

export type StructuredFieldKind = "string" | "stringArray" | "number" | "currency" | "isoDate" | "enum";

export interface StructuredBusinessField {
  name: string;
  kind: StructuredFieldKind;
  /** `kind: "enum"` 时必填 */
  enumValues?: readonly string[];
  /** 数值不得为负（数量/金额/预算/费用基数等） */
  nonNegative?: boolean;
  /** 允许显式 `null`（未知即未知；不允许用 0/空串代替） */
  nullable?: boolean;
}

export interface StructuredArtifactSpec {
  /** `project`：必须完整关联 project（产品/版本可为空）；`organization`：公司级，允许无项目 */
  scope: "project" | "organization";
  /** 该类型的最小业务字段（契约 B 节「最小业务字段」列） */
  businessFields: readonly StructuredBusinessField[];
}

export const STRUCTURED_ARTIFACT_REGISTRY = {
  /** 公司级简报：组织归属必填，产品/项目可为空（契约 A 节明确例外） */
  COMPANY_BRAND_BRIEF: {
    scope: "organization",
    businessFields: [
      { name: "goals", kind: "stringArray" },
      { name: "audience", kind: "stringArray" },
      { name: "channels", kind: "stringArray" },
      { name: "resources", kind: "stringArray" },
      { name: "forbiddenItems", kind: "stringArray" },
      { name: "confirmedFactRefs", kind: "stringArray" },
      { name: "confirmedFactVersion", kind: "string", nullable: true },
    ],
  },
  COST_SCENARIO: {
    scope: "project",
    businessFields: [
      { name: "engineVersion", kind: "string" },
      { name: "scenarioName", kind: "string" },
      { name: "currency", kind: "currency" },
      { name: "unit", kind: "string" },
      { name: "expenseBase", kind: "string" },
      { name: "result", kind: "number" },
    ],
  },
  PROFESSIONAL_ANALYSIS: {
    scope: "project",
    businessFields: [
      {
        name: "conclusion",
        kind: "enum",
        enumValues: ["PROCEED_TO_VALIDATE", "NEEDS_EVIDENCE", "PAUSE", "REJECT"],
      },
      { name: "summary", kind: "string" },
      { name: "companyFit", kind: "stringArray" },
      { name: "claims", kind: "stringArray" },
      { name: "alternatives", kind: "stringArray" },
      { name: "economicScenarioRef", kind: "string", nullable: true },
      { name: "risks", kind: "stringArray" },
      { name: "unknowns", kind: "stringArray" },
      { name: "recommendedActions", kind: "stringArray" },
      { name: "limitations", kind: "stringArray" },
    ],
  },
  PROFESSIONAL_CONFIRMATION: {
    scope: "project",
    businessFields: [
      { name: "domain", kind: "string" },
      { name: "appliesToIdentity", kind: "string" },
      { name: "appliesToRegion", kind: "string" },
      { name: "appliesToChannel", kind: "string" },
      { name: "materialRefs", kind: "stringArray" },
      { name: "scopeItems", kind: "stringArray" },
      { name: "validUntil", kind: "isoDate", nullable: true },
      { name: "confirmedByPerson", kind: "string" },
      { name: "recordedByPerson", kind: "string" },
    ],
  },
  PRODUCTION_PLAN: {
    scope: "project",
    businessFields: [
      { name: "quantity", kind: "number", nonNegative: true },
      { name: "unit", kind: "string" },
      { name: "budget", kind: "number", nonNegative: true },
      { name: "currency", kind: "currency" },
      { name: "quoteRefs", kind: "stringArray" },
      { name: "sampleRefs", kind: "stringArray" },
      { name: "packagingRefs", kind: "stringArray" },
      { name: "leadTime", kind: "string", nullable: true },
      { name: "productionConditions", kind: "stringArray" },
      { name: "stopConditions", kind: "stringArray" },
    ],
  },
  BUSINESS_OBSERVATION: {
    scope: "project",
    businessFields: [
      { name: "channel", kind: "string" },
      { name: "period", kind: "string" },
      { name: "currency", kind: "currency" },
      { name: "quantity", kind: "number", nonNegative: true },
      { name: "revenue", kind: "number", nonNegative: true },
      { name: "refund", kind: "number", nonNegative: true },
      { name: "expenseSource", kind: "string" },
      { name: "sampleSize", kind: "number", nonNegative: true, nullable: true },
      { name: "basis", kind: "string" },
    ],
  },
} as const satisfies Record<string, StructuredArtifactSpec>;

export type StructuredArtifactType = keyof typeof STRUCTURED_ARTIFACT_REGISTRY;

export function isStructuredArtifactType(type: string): type is StructuredArtifactType {
  return Object.prototype.hasOwnProperty.call(STRUCTURED_ARTIFACT_REGISTRY, type);
}

/** 已知 schema 版本（含历史结构化版本；未知版本一律拒绝解析，契约 §4.3 规则 1）。 */
export const KNOWN_ARTIFACT_SCHEMA_VERSIONS: readonly string[] = [ARTIFACT_SCHEMA_VERSION];

export function isKnownArtifactSchemaVersion(version: string): boolean {
  return KNOWN_ARTIFACT_SCHEMA_VERSIONS.includes(version);
}
