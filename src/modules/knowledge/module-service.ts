/**
 * 批次 D：四模块条目的录入 / 回填服务层。
 *
 * 与 P0-1 报价通道同源的三条铁律（改这个文件前先读）：
 * 1. **无来源不落库**：`sourceRef` 必填。这是 kern 合成时敢引用并标注出处的唯一理由。
 * 2. **缺即缺，不估算**：数值字段一律可空，没有实测数字就留空，不做任何补齐。
 * 3. **不预置内容**：本文件不提供任何"行业默认条目"——凭空写出来就是编造。
 *
 * 校验与校验错误在这里抛（`UnprocessableEntityError` → 422），路由层只做搬运，
 * 因此契约测试无需数据库即可覆盖。
 */

import type { KnowledgeModule, Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { asAuthorityTier } from "./module-provider";

export const KNOWLEDGE_MODULES: KnowledgeModule[] = [
  "COMPLIANCE_REDLINE",
  "CATEGORY_FRAMEWORK",
  "CHANNEL_ACCESS",
  "OPERATION_SOP",
];

export const AUTHORITY_TIER_VALUES = ["first_party", "curated", "public", "unknown"] as const;

/** 单次录入条数上限：防一次请求灌进整本手册。 */
export const MAX_ENTRIES_PER_REQUEST = 200;

const CAP = {
  key: 80,
  title: 200,
  statement: 500,
  scopeLabel: 200,
  sourceRef: 300,
  metricKey: 80,
  unit: 24,
  textValue: 300,
  note: 500,
} as const;

export interface NormalizedEntryInput {
  module: KnowledgeModule;
  key: string;
  title: string;
  statement?: string;
  scopeLabel?: string;
  sourceRef: string;
  authorityTier: string;
  appliesTo?: Prisma.InputJsonValue;
}

export interface NormalizedBackfillInput {
  entryId?: string;
  metricKey: string;
  numericLow?: number;
  numericHigh?: number;
  numericValue?: number;
  unit?: string;
  textValue?: string;
  observedAt: Date;
  sourceRef: string;
  note?: string;
}

function trimmed(value: unknown, field: string, cap: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new UnprocessableEntityError(`${field} 必须是字符串`);
  const t = value.trim();
  if (!t) return undefined;
  if (t.length > cap) throw new UnprocessableEntityError(`${field} 超过 ${cap} 字符上限`);
  return t;
}

function required(value: unknown, field: string, cap: number): string {
  const t = trimmed(value, field, cap);
  if (!t) throw new UnprocessableEntityError(`${field} 必填`);
  return t;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new UnprocessableEntityError(`${field} 必须是数字`);
  return n;
}

export function isKnowledgeModule(value: unknown): value is KnowledgeModule {
  return typeof value === "string" && (KNOWLEDGE_MODULES as string[]).includes(value);
}

/** 一条条目输入 → 已校验的可落库对象。缺必填 / 类型不对一律 422。 */
export function normalizeEntryInput(input: unknown): NormalizedEntryInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new UnprocessableEntityError("请求体必须是 JSON 对象");
  }
  const raw = input as Record<string, unknown>;
  if (!isKnowledgeModule(raw.module)) {
    throw new UnprocessableEntityError(`module 必须是 ${KNOWLEDGE_MODULES.join(" / ")} 之一`);
  }
  const key = required(raw.key, "key", CAP.key);
  const title = required(raw.title, "title", CAP.title);
  // 铁律 1：无来源不落库
  const sourceRef = required(raw.sourceRef, "sourceRef", CAP.sourceRef);

  let authorityTier = "curated";
  if (raw.authorityTier !== undefined && raw.authorityTier !== null && raw.authorityTier !== "") {
    const t = trimmed(raw.authorityTier, "authorityTier", 24)!;
    if (!(AUTHORITY_TIER_VALUES as readonly string[]).includes(t)) {
      throw new UnprocessableEntityError(`authorityTier 必须是 ${AUTHORITY_TIER_VALUES.join(" / ")} 之一`);
    }
    authorityTier = t;
  }

  let appliesTo: Prisma.InputJsonValue | undefined;
  if (raw.appliesTo !== undefined && raw.appliesTo !== null) {
    if (typeof raw.appliesTo !== "object" || Array.isArray(raw.appliesTo)) {
      throw new UnprocessableEntityError("appliesTo 必须是 JSON 对象");
    }
    appliesTo = raw.appliesTo as Prisma.InputJsonValue;
  }

  const out: NormalizedEntryInput = {
    module: raw.module,
    key,
    title,
    sourceRef,
    authorityTier,
  };
  const statement = trimmed(raw.statement, "statement", CAP.statement);
  if (statement) out.statement = statement;
  const scopeLabel = trimmed(raw.scopeLabel, "scopeLabel", CAP.scopeLabel);
  if (scopeLabel) out.scopeLabel = scopeLabel;
  if (appliesTo) out.appliesTo = appliesTo;
  return out;
}

/** 一条回填输入 → 已校验的可落库对象。 */
export function normalizeBackfillInput(input: unknown): NormalizedBackfillInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new UnprocessableEntityError("请求体必须是 JSON 对象");
  }
  const raw = input as Record<string, unknown>;
  const metricKey = required(raw.metricKey, "metricKey", CAP.metricKey);
  // 铁律 1：无来源不落库
  const sourceRef = required(raw.sourceRef, "sourceRef", CAP.sourceRef);

  if (raw.observedAt === undefined || raw.observedAt === null || raw.observedAt === "") {
    throw new UnprocessableEntityError("observedAt 必填（观测时间，用于判定新鲜度）");
  }
  const observedAt = new Date(String(raw.observedAt));
  if (Number.isNaN(observedAt.getTime())) {
    throw new UnprocessableEntityError("observedAt 不是合法时间");
  }

  const numericLow = optionalNumber(raw.numericLow, "numericLow");
  const numericHigh = optionalNumber(raw.numericHigh, "numericHigh");
  const numericValue = optionalNumber(raw.numericValue, "numericValue");
  const textValue = trimmed(raw.textValue, "textValue", CAP.textValue);

  // 铁律 2 的反面：允许空，但**全空就没意义** —— 至少得有一个值或原样描述，
  // 否则这条回填在合成层只会产出「有回填记录但未填数值」这种噪音。
  if (numericLow == null && numericHigh == null && numericValue == null && !textValue) {
    throw new UnprocessableEntityError("回填至少要有数值（numericValue / numericLow+High）或 textValue");
  }
  if ((numericLow == null) !== (numericHigh == null)) {
    throw new UnprocessableEntityError("numericLow 与 numericHigh 必须成对给出（区间回填）");
  }
  if (numericLow != null && numericHigh != null && numericLow > numericHigh) {
    throw new UnprocessableEntityError("numericLow 不得大于 numericHigh");
  }

  const out: NormalizedBackfillInput = { metricKey, sourceRef, observedAt };
  if (numericLow != null) out.numericLow = numericLow;
  if (numericHigh != null) out.numericHigh = numericHigh;
  if (numericValue != null) out.numericValue = numericValue;
  if (textValue) out.textValue = textValue;
  const unit = trimmed(raw.unit, "unit", CAP.unit);
  if (unit) out.unit = unit;
  const note = trimmed(raw.note, "note", CAP.note);
  if (note) out.note = note;
  const entryId = trimmed(raw.entryId, "entryId", 64);
  if (entryId) out.entryId = entryId;
  return out;
}

/** 批量录入条目。同组织内 (module, key) 重复 → upsert（内容以最新来源为准）。 */
export async function upsertModuleEntries(
  organizationId: string,
  createdById: string,
  inputs: NormalizedEntryInput[]
) {
  const results = [];
  for (const input of inputs) {
    const data = {
      organizationId,
      module: input.module,
      key: input.key,
      title: input.title,
      statement: input.statement ?? null,
      scopeLabel: input.scopeLabel ?? null,
      sourceRef: input.sourceRef,
      authorityTier: input.authorityTier,
      appliesTo: input.appliesTo ?? undefined,
      createdById,
      deletedAt: null,
    };
    const row = await prisma.knowledgeModuleEntry.upsert({
      where: {
        organizationId_module_key: {
          organizationId,
          module: input.module,
          key: input.key,
        },
      },
      create: data,
      update: {
        title: data.title,
        statement: data.statement,
        scopeLabel: data.scopeLabel,
        sourceRef: data.sourceRef,
        authorityTier: data.authorityTier,
        appliesTo: data.appliesTo,
      },
    });
    results.push(row);
  }
  return results;
}

/** 录入回填。entryId 给了就必须属于本组织且存在（否则 404，不泄露他组织条目）。 */
export async function createBackfill(
  organizationId: string,
  createdById: string,
  input: NormalizedBackfillInput
) {
  if (input.entryId) {
    const entry = await prisma.knowledgeModuleEntry.findFirst({
      where: { id: input.entryId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!entry) throw new NotFoundError("KnowledgeModuleEntry not found");
  }
  return prisma.knowledgeBackfill.create({
    data: {
      organizationId,
      entryId: input.entryId ?? null,
      metricKey: input.metricKey,
      numericLow: input.numericLow ?? null,
      numericHigh: input.numericHigh ?? null,
      numericValue: input.numericValue ?? null,
      unit: input.unit ?? null,
      textValue: input.textValue ?? null,
      observedAt: input.observedAt,
      sourceRef: input.sourceRef,
      note: input.note ?? null,
      createdById,
    },
  });
}

export async function listModuleEntries(organizationId: string, module?: KnowledgeModule) {
  return prisma.knowledgeModuleEntry.findMany({
    where: { organizationId, deletedAt: null, ...(module ? { module } : {}) },
    include: { backfills: { orderBy: { observedAt: "desc" } } },
    orderBy: [{ module: "asc" }, { key: "asc" }],
    take: 500,
  });
}

export async function listBackfills(organizationId: string, filter: { metricKey?: string; entryId?: string }) {
  return prisma.knowledgeBackfill.findMany({
    where: {
      organizationId,
      ...(filter.metricKey ? { metricKey: filter.metricKey } : {}),
      ...(filter.entryId ? { entryId: filter.entryId } : {}),
    },
    orderBy: { observedAt: "desc" },
    take: 500,
  });
}

/** 软删条目：限创建者本人（路由层先鉴权，这里只做归属确认）。 */
export async function softDeleteEntry(organizationId: string, id: string, userId: string) {
  const entry = await prisma.knowledgeModuleEntry.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: { id: true, createdById: true },
  });
  if (!entry) throw new NotFoundError("KnowledgeModuleEntry not found");
  // 破坏性操作限创建者本人 —— 与成本情景 PUT/DELETE 同口径：
  // 明确 403（无权）而不是伪装成 404（找不到）。
  if (entry.createdById !== userId) {
    throw new ForbiddenError("只有条目的创建者可以删除它");
  }
  return prisma.knowledgeModuleEntry.update({ where: { id }, data: { deletedAt: new Date() } });
}

export { asAuthorityTier };
