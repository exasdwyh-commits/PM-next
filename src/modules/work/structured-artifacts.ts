/**
 * 结构化成果统一 helper（TASK-009a；计划 §1.7 / 契约「结构化成果与门禁契约」A·B 节）
 *
 * 对外能力：
 *   - `validateStructuredArtifact()`：校验公共信封 + 该类型最小业务字段，返回**字段级**错误（不抛）
 *   - `assertStructuredArtifact()`  ：同上，失败即抛 `UnprocessableEntityError`（422）
 *   - `readStructuredArtifact()`    ：解析读取；**未知版本拒绝**；历史自由文本**只读兼容**
 *   - `writeStructuredArtifact()`   ：经既有 `Artifact` 行写入（同事务），新内容**追加保存**
 *   - `computeInputFingerprint()`   ：规范化 JSON 的 SHA-256（键排序、引用按 id 排序）
 *
 * 边界（有意不做，契约 A 节）：
 *   - **不**新建第二套提交/审核系统：写入只落既有 `Artifact` 行，由既有 `submitWork()` /
 *     `reviewWork()` 的同事务路径调用（9b 接线）。审核权威状态永远来自 `WorkSubmission` /
 *     `Artifact.reviewStatus`，**从不**信任 JSON 里的 `confirmedBy`。
 *   - **不猜测**：未登记类型、未知版本、`schemaVersion` 列与 JSON 不一致，一律拒绝并报 422。
 */
import crypto from "crypto";
import { Prisma, ProducerType, ArtifactReviewStatus } from "@prisma/client";
import { UnprocessableEntityError } from "@/shared/errors";
import {
  ARTIFACT_SCHEMA_VERSION,
  KNOWN_ARTIFACT_SCHEMA_VERSIONS,
  STRUCTURED_ARTIFACT_REGISTRY,
  STRUCTURED_ENVELOPE_FIELDS,
  STRUCTURED_LINK_FIELDS,
  StructuredArtifactType,
  StructuredBusinessField,
  isKnownArtifactSchemaVersion,
  isStructuredArtifactType,
} from "./artifact-schema";

export type FieldErrors = Record<string, string[]>;

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/;
const CURRENCY = /^[A-Z]{3}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function pushError(errors: FieldErrors, field: string, msg: string): void {
  (errors[field] ??= []).push(msg);
}

/** 信封保留键：业务输入里出现同名键时**以服务端信封为准**，且不参与指纹。 */
export const ENVELOPE_RESERVED_KEYS: readonly string[] = [...STRUCTURED_ENVELOPE_FIELDS, ...STRUCTURED_LINK_FIELDS];

/**
 * 规范化：对象键递归排序；数组若元素均带字符串 `id` 则按 `id` 排序（引用集合顺序不影响指纹）。
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    const allHaveId = items.every(
      (v) =>
        v !== null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof (v as Record<string, unknown>).id === "string"
    );
    return allHaveId
      ? [...items].sort((a, b) =>
          String((a as Record<string, unknown>).id).localeCompare(String((b as Record<string, unknown>).id))
        )
      : items;
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonicalize(source[key]);
    return out;
  }
  return value;
}

/**
 * 输入指纹：规范化业务输入的 SHA-256。
 * 只覆盖**业务输入**（不含生成时间、排版、键序、引用顺序）⇒ 同输入必同指纹。
 */
export function computeInputFingerprint(businessInput: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(businessInput))).digest("hex");
}

/** 业务输入（剔除信封保留键）—— 只这一部分参与指纹与合并。 */
export function pickBusinessInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ENVELOPE_RESERVED_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

function validateStringArray(field: string, v: unknown, errors: FieldErrors): void {
  if (!Array.isArray(v)) {
    pushError(errors, field, "必须是数组（无内容时给空数组，并在 missingInputs 说明，不得用空串掩盖）");
    return;
  }
  v.forEach((item, i) => {
    if (!isNonEmptyString(item)) pushError(errors, `${field}[${i}]`, "必须是非空字符串（不得用空字符串或零代替缺失）");
  });
}

function validateBusinessField(field: StructuredBusinessField, v: unknown, errors: FieldErrors): void {
  const name = field.name;
  if (v === undefined || v === null) {
    if (field.nullable) return;
    pushError(errors, name, "必填（确实未知时请列入 missingInputs，不要省略或用 0/空串代替）");
    return;
  }
  switch (field.kind) {
    case "string":
      if (!isNonEmptyString(v)) pushError(errors, name, "必须是非空字符串");
      break;
    case "stringArray":
      validateStringArray(name, v, errors);
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) {
        pushError(errors, name, "必须是有限数值");
        break;
      }
      if (field.nonNegative && v < 0) pushError(errors, name, "不得为负");
      break;
    case "currency":
      if (typeof v !== "string" || !CURRENCY.test(v)) pushError(errors, name, "必须是三位大写 ISO 币种代码（如 CNY）");
      break;
    case "isoDate":
      if (typeof v !== "string" || !ISO_DATE.test(v)) pushError(errors, name, "必须是 ISO 日期/时间字符串");
      break;
    case "enum":
      if (typeof v !== "string" || !(field.enumValues ?? []).includes(v)) {
        pushError(errors, name, `允许值：${(field.enumValues ?? []).join(" / ")}`);
      }
      break;
  }
}

export interface StructuredArtifactValidationInput {
  /** 成果类型（取自 `Artifact.type` 列 —— 单一事实来源，不在 JSON 里重复存） */
  type: string;
  /** 待写入的 JSON 对象（未序列化） */
  value: Record<string, unknown>;
}

export interface StructuredArtifactValidationResult {
  ok: boolean;
  fieldErrors: FieldErrors;
  /** 规范化后的信封 + 业务字段（仅 `ok` 时有意义） */
  normalized?: Record<string, unknown>;
}

export function validateStructuredArtifact(input: StructuredArtifactValidationInput): StructuredArtifactValidationResult {
  const { type, value } = input;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, fieldErrors: { content: ["必须是 JSON 对象（坏 JSON 或非对象一律拒绝）"] } };
  }
  if (!isStructuredArtifactType(type)) {
    return {
      ok: false,
      fieldErrors: { type: ["未登记的结构化成果类型：新增类型必须先登记到 artifact-schema.ts（不猜、不放行）"] },
    };
  }
  const spec = STRUCTURED_ARTIFACT_REGISTRY[type];
  const errors: FieldErrors = {};

  const version = value.schemaVersion;
  if (typeof version !== "string" || version === "") pushError(errors, "schemaVersion", "必填");
  else if (!isKnownArtifactSchemaVersion(version)) {
    pushError(errors, "schemaVersion", `未知版本 ${version}（已知：${KNOWN_ARTIFACT_SCHEMA_VERSIONS.join(" / ")}）`);
  }

  if (!isNonEmptyString(value.organizationId)) {
    pushError(errors, "organizationId", "必填，且必须由服务端按 session / 项目关系推导（不信任请求体）");
  }

  if (!Array.isArray(value.sourceRefs)) {
    pushError(errors, "sourceRefs", "必填数组（无来源时显式空数组，并列入 missingInputs）");
  } else {
    value.sourceRefs.forEach((ref, i) => {
      if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
        pushError(errors, `sourceRefs[${i}]`, "必须是对象");
        return;
      }
      const r = ref as Record<string, unknown>;
      if (!isNonEmptyString(r.id)) pushError(errors, `sourceRefs[${i}].id`, "必填（来源 ID）");
      if (r.hash !== undefined && !isNonEmptyString(r.hash)) pushError(errors, `sourceRefs[${i}].hash`, "必须是非空字符串");
      if (r.retrievedAt !== undefined && (typeof r.retrievedAt !== "string" || !ISO_DATE.test(r.retrievedAt))) {
        pushError(errors, `sourceRefs[${i}].retrievedAt`, "必须是 ISO 时间字符串");
      }
    });
  }

  if (typeof value.inputFingerprint !== "string" || !HEX64.test(value.inputFingerprint)) {
    pushError(errors, "inputFingerprint", "必须是规范化业务输入的 SHA-256（64 位小写十六进制）");
  }
  if (value.dataNature !== "REAL" && value.dataNature !== "DEMO") {
    pushError(errors, "dataNature", "只允许 REAL / DEMO（合成成果不得进入真实门禁）");
  }
  validateStringArray("assumptions", value.assumptions, errors);
  validateStringArray("missingInputs", value.missingInputs, errors);
  if (!isNonEmptyString(value.recordedBy)) {
    pushError(errors, "recordedBy", "必填（记录人来自 session，不由请求体指定）");
  }

  const confirmedBy = value.confirmedBy ?? null;
  const confirmedAt = value.confirmedAt ?? null;
  if (confirmedBy !== null && !isNonEmptyString(confirmedBy)) pushError(errors, "confirmedBy", "未确认必须是 null（不填虚构人名）");
  if (confirmedAt !== null && (typeof confirmedAt !== "string" || !ISO_DATE.test(confirmedAt))) {
    pushError(errors, "confirmedAt", "未确认必须是 null；已确认须为 ISO 时间");
  }
  if ((confirmedBy === null) !== (confirmedAt === null)) {
    pushError(errors, "confirmedBy", "confirmedBy / confirmedAt 必须同时为空或同时有值");
  }

  if (spec.scope === "project" && !isNonEmptyString(value.projectId)) {
    pushError(errors, "projectId", "项目级成果必须关联项目（公司级简报是唯一例外）");
  }
  for (const link of STRUCTURED_LINK_FIELDS) {
    const v = value[link];
    if (v !== undefined && v !== null && !isNonEmptyString(v)) pushError(errors, link, "必须是字符串或 null");
  }

  for (const field of spec.businessFields) validateBusinessField(field, value[field.name], errors);

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return { ok: true, fieldErrors: {}, normalized: canonicalize(value) as Record<string, unknown> };
}

/** 校验失败即抛 422（字段级错误随 `fieldErrors` 下发，调用方可直接定位）。 */
export function assertStructuredArtifact(input: StructuredArtifactValidationInput): Record<string, unknown> {
  const result = validateStructuredArtifact(input);
  if (!result.ok) {
    throw new UnprocessableEntityError(`结构化成果校验失败：${Object.keys(result.fieldErrors).join("、")}`, result.fieldErrors);
  }
  return result.normalized!;
}

export interface ReadStructuredArtifactInput {
  /** `Artifact.type` */
  type: string;
  /** `Artifact.content` */
  content: string;
  /** `Artifact.schemaVersion` 列（可查询副本）；`null` = 未版本化（历史自由文本） */
  schemaVersion: string | null;
}

export type StructuredArtifactReadResult =
  | { kind: "structured"; value: Record<string, unknown> }
  | { kind: "legacy-free-text"; content: string };

/**
 * 读取成果内容。
 *
 * - `schemaVersion` 列为 `null` → **历史自由文本**：原样返回，`kind = legacy-free-text`，
 *   **不**尝试把它解释成结构化成果（没有版本声明就没有解释依据；契约要求「自由文本历史可读
 *   但不伪装结构成果」）。
 * - 列有版本但未知 → 422（未知版本拒绝解析，不"尽力猜"）。
 * - 列与 JSON 顶层版本不一致、JSON 损坏、结构校验不通过 → 422（含字段级错误）。
 */
export function readStructuredArtifact(input: ReadStructuredArtifactInput): StructuredArtifactReadResult {
  const { type, content, schemaVersion } = input;
  if (schemaVersion === null) return { kind: "legacy-free-text", content };

  if (!isKnownArtifactSchemaVersion(schemaVersion)) {
    throw new UnprocessableEntityError(
      `未知成果 schema 版本：${schemaVersion}（已知：${KNOWN_ARTIFACT_SCHEMA_VERSIONS.join(" / ")}）`,
      { schemaVersion: ["未知版本，拒绝解析（不猜）"] }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new UnprocessableEntityError("成果内容不是合法 JSON，无法按结构化成果解析", { content: ["坏 JSON"] });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnprocessableEntityError("成果内容必须是 JSON 对象", { content: ["必须是 JSON 对象"] });
  }
  const value = parsed as Record<string, unknown>;
  if (value.schemaVersion !== schemaVersion) {
    throw new UnprocessableEntityError(
      `schemaVersion 列（${schemaVersion}）与内容顶层（${String(value.schemaVersion)}）不一致`,
      { schemaVersion: ["列与内容版本不一致（列 = 常量，内容顶层必须同值）"] }
    );
  }
  const result = validateStructuredArtifact({ type, value });
  if (!result.ok) {
    throw new UnprocessableEntityError(
      `结构化成果校验失败：${Object.keys(result.fieldErrors).join("、")}`,
      result.fieldErrors
    );
  }
  return { kind: "structured", value: result.normalized! };
}

/** 写入所需的最小客户端面（`Prisma.TransactionClient` 或 `PrismaClient` 均可）。 */
export type ArtifactWriteClient = Pick<Prisma.TransactionClient, "artifact">;

export interface WriteStructuredArtifactParams {
  type: StructuredArtifactType;
  title: string;
  workItemId: string;
  /** 同一提交批次的回执（迟到提交等场景可为空） */
  submissionId?: string | null;
  inputRevision: number;
  /** 参与指纹的**业务输入**（信封保留键会被剔除，永不覆盖服务端信封） */
  businessInput: Record<string, unknown>;
  envelope: {
    organizationId: string;
    projectId?: string | null;
    productId?: string | null;
    productVersionId?: string | null;
    sourceRefs?: readonly Record<string, unknown>[];
    dataNature: "REAL" | "DEMO";
    assumptions?: readonly string[];
    missingInputs: readonly string[];
    recordedBy: string;
    confirmedBy?: string | null;
    confirmedAt?: string | null;
  };
  producerType?: ProducerType;
  /** 既有证据引用（透传到 `Artifact.evidenceRefs`） */
  evidenceRefs?: unknown;
  /** 初始审核状态；仅 A09 迟到分支按现有行为置 REJECTED，其余走模型默认 PENDING。 */
  reviewStatus?: ArtifactReviewStatus;
}

/**
 * 写入一条结构化成果（**追加保存**：`contentVersion` 在同 `workItem + type` 上递增，旧版本不被覆盖）。
 *
 * 只落既有 `Artifact` 行：**不**创建提交/审核记录（那是 `submitWork()` / `reviewWork()` 的职责），
 * 因此必须传入同一个事务客户端以复用既有链路。
 */
export async function writeStructuredArtifact(tx: ArtifactWriteClient, params: WriteStructuredArtifactParams) {
  const businessInput = pickBusinessInput(params.businessInput);
  // 信封字段一律以服务端推导为准：`dataNature` 由运行方式决定（TEST_STUB→DEMO，其余→REAL），
  // 调用方若给了同名值（含业务输入里显式声明的 REAL）都必须被忽略——合成成果不得借声明进入真实门禁。
  const value: Record<string, unknown> = {
    ...businessInput,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    organizationId: params.envelope.organizationId,
    projectId: params.envelope.projectId ?? null,
    productId: params.envelope.productId ?? null,
    productVersionId: params.envelope.productVersionId ?? null,
    sourceRefs: params.envelope.sourceRefs ? [...params.envelope.sourceRefs] : [],
    inputFingerprint: computeInputFingerprint(businessInput),
    dataNature: params.envelope.dataNature,
    assumptions: params.envelope.assumptions ? [...params.envelope.assumptions] : [],
    missingInputs: [...params.envelope.missingInputs],
    recordedBy: params.envelope.recordedBy,
    confirmedBy: params.envelope.confirmedBy ?? null,
    confirmedAt: params.envelope.confirmedAt ?? null,
  };
  const normalized = assertStructuredArtifact({ type: params.type, value });

  const last = await tx.artifact.findFirst({
    where: { workItemId: params.workItemId, type: params.type },
    orderBy: { contentVersion: "desc" },
    select: { contentVersion: true },
  });

  return tx.artifact.create({
    data: {
      workItemId: params.workItemId,
      submissionId: params.submissionId ?? null,
      organizationId: params.envelope.organizationId,
      productVersionId: params.envelope.productVersionId ?? null,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      type: params.type,
      title: params.title,
      content: JSON.stringify(normalized),
      producerType: params.producerType ?? ProducerType.MANUAL,
      inputRevision: params.inputRevision,
      contentVersion: (last?.contentVersion ?? 0) + 1,
      // evidenceRefs 未提供时保持列默认 NULL（与既有 submitWork 行为一致），不写 JSON null。
      ...(params.evidenceRefs !== undefined ? { evidenceRefs: params.evidenceRefs as Prisma.InputJsonValue } : {}),
      ...(params.reviewStatus ? { reviewStatus: params.reviewStatus } : {}),
    },
  });
}
