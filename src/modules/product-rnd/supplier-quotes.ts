/**
 * P0-1 真实报价 / 资料入库通道（数据供给侧）
 * ==================================================
 * 路线图 P0-1：specialist 现在「守法罢工」——诚实架构是长板，但缺真实输入，
 * 规划好的深度报告 ①② 块只能很诚实地空着。本模块把「真实资料 → 结构化行 →
 * 深度报告块」这条链路打通，让 ①② 块在有真实资料时自动点亮。
 *
 * 三条不可动摇的口径（改这个文件前先读）：
 * 1. **无来源不落库**：每一行必须锚定一条真实 Evidence（报价单 / 检测报告 / 供应商资料）。
 *    没有来源锚点的行在本通道里不存在 —— 这是深度报告敢把数字显示出来的唯一理由。
 * 2. **缺即缺，不估算**：单价 / 规格没有资料支撑时保持空，视图显式标缺（"—"），
 *    绝不用默认值、区间中值或行业经验补齐。雷①（playbook 整片硬编码假数据）的教训。
 * 3. **不可信来源不消费**：DEMO 资料与被 REJECTED 的资料不进入报告，
 *    其余如实标注核验状态（UNVERIFIED 也照实标，不冒充已核验）。
 *
 * 组装逻辑一律写成**纯函数**：executor 只做数据搬运，判断与映射全在这里，
 * 因此契约测试无需数据库即可覆盖（与 deep-report.ts 同构）。
 */

import prisma from "@/shared/db";
import { Role, type SupplierQuoteKind } from "@prisma/client";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import {
  DEEP_BOM_LINES_CAP,
  DEEP_SPEC_ROWS_CAP,
} from "@/modules/product-rnd/deep-report";
import type {
  ExecutiveReportDeepBom,
  ExecutiveReportDeepSpec,
} from "@/shared/executive-report-types";

export const SUPPLIER_QUOTE_KINDS = ["SPEC", "PRICE"] as const;
export type SupplierQuoteKindValue = (typeof SUPPLIER_QUOTE_KINDS)[number];

/** 单次录入的行数上限：防止一次请求灌入整本报价单把事务拖垮。 */
export const MAX_QUOTE_ROWS_PER_REQUEST = 200;

/** 单行各字段的长度上限（与深度报告契约的截断口径保持一致，避免落库后再被截一次）。 */
const FIELD_CAP = {
  item: 120,
  supplier: 120,
  spec: 200,
  uom: 24,
  moq: 80,
  note: 200,
  currency: 8,
} as const;

/** 显式标缺：与深度报告契约里 `total: "—"` 的语义一致，表示「有资料但该项没有数字」。 */
export const MISSING_MARK = "—";

export function isSupplierQuoteKind(value: unknown): value is SupplierQuoteKindValue {
  return typeof value === "string" && (SUPPLIER_QUOTE_KINDS as readonly string[]).includes(value);
}

/** 一行已校验、可直接落库的报价 / 规格行。 */
export interface NormalizedQuoteRow {
  item: string;
  supplier?: string;
  spec?: string;
  uom?: string;
  moq?: string;
  unitPrice?: number;
  currency?: string;
  quotedAt?: Date;
  note?: string;
}

/**
 * 录入行校验失败。
 *
 * 继承 UnprocessableEntityError 而不是裸 Error：统一错误处理靠 statusCode 决定响应码，
 * 裸 Error 会被当成服务端故障映射成 500，而这里的事实是「调用方填错了」。
 */
export class QuoteRowValidationError extends UnprocessableEntityError {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRowValidationError";
  }
}

function trimmed(value: unknown, cap: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.slice(0, cap);
}

/**
 * 校验并规范化录入行。
 *
 * 抛 `QuoteRowValidationError`（路由层映射为 422）—— 之所以不用返回值表示失败，
 * 是因为调用方需要知道**哪一行哪一项**不合格，错误消息要能直接回给用户。
 */
export function normalizeQuoteRows(
  raw: unknown,
  cap = MAX_QUOTE_ROWS_PER_REQUEST
): NormalizedQuoteRow[] {
  if (!Array.isArray(raw)) {
    throw new QuoteRowValidationError("rows 必须是数组");
  }
  if (raw.length === 0) {
    throw new QuoteRowValidationError("rows 不能为空：至少要有一行真实资料");
  }
  if (raw.length > cap) {
    throw new QuoteRowValidationError(`rows 最多 ${cap} 行（实际 ${raw.length} 行）`);
  }

  return raw.map((entry, index) => {
    const at = `第 ${index + 1} 行`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new QuoteRowValidationError(`${at}必须是对象`);
    }
    const row = entry as Record<string, unknown>;

    const item = trimmed(row.item, FIELD_CAP.item);
    if (!item) {
      throw new QuoteRowValidationError(`${at}缺少 item（物料 / 规格项名称）`);
    }

    // 单价：允许 null / 空白（= 有资料但没给价，如实标缺），但**给了就必须是有限非负数**。
    // 负数与 NaN 一律拒绝：宁可让调用方重填，也不落一条说不清的数字进库。
    let unitPrice: number | undefined;
    if (row.unitPrice !== undefined && row.unitPrice !== null && row.unitPrice !== "") {
      const n = typeof row.unitPrice === "number" ? row.unitPrice : Number(row.unitPrice);
      if (!Number.isFinite(n)) {
        throw new QuoteRowValidationError(`${at}unitPrice 不是有效数字`);
      }
      if (n < 0) {
        throw new QuoteRowValidationError(`${at}unitPrice 不能为负数`);
      }
      unitPrice = n;
    }

    // 报价日期：非法格式直接拒绝（资料是否过期由它判定，静默吞掉会让过期报价冒充新鲜报价）。
    let quotedAt: Date | undefined;
    if (row.quotedAt !== undefined && row.quotedAt !== null && row.quotedAt !== "") {
      const d = new Date(String(row.quotedAt));
      if (Number.isNaN(d.getTime())) {
        throw new QuoteRowValidationError(`${at}quotedAt 不是合法日期（应为 ISO 日期时间）`);
      }
      quotedAt = d;
    }

    return {
      item,
      supplier: trimmed(row.supplier, FIELD_CAP.supplier),
      spec: trimmed(row.spec, FIELD_CAP.spec),
      uom: trimmed(row.uom, FIELD_CAP.uom),
      moq: trimmed(row.moq, FIELD_CAP.moq),
      unitPrice,
      currency: trimmed(row.currency, FIELD_CAP.currency),
      quotedAt,
      note: trimmed(row.note, FIELD_CAP.note),
    };
  });
}

/**
 * 取项目下可用于报告的真实报价 / 规格行。
 *
 * 只消费「真实且未被判废」的资料：nature=REAL 且 verifyStatus≠REJECTED。
 * UNVERIFIED 照常返回 —— 真实性由上传资料本身保证，核验状态只是附加的可信度信号，
 * 在报告里如实标注即可，不能反过来把它藏掉（藏掉等于把未核验冒充成已核验）。
 */
export async function loadProjectQuotes(
  projectId: string,
  organizationId: string,
  kind?: SupplierQuoteKindValue
) {
  return prisma.supplierQuote.findMany({
    where: {
      projectId,
      organizationId,
      ...(kind ? { kind: kind as SupplierQuoteKind } : {}),
      evidence: {
        nature: "REAL",
        verifyStatus: { not: "REJECTED" },
      },
    },
    include: {
      evidence: {
        select: {
          id: true,
          source: true,
          verifyStatus: true,
          originalFilename: true,
          obtainedAt: true,
        },
      },
    },
    orderBy: [{ quotedAt: "desc" }, { createdAt: "desc" }],
  });
}

export type LoadedQuote = Awaited<ReturnType<typeof loadProjectQuotes>>[number];

/** 来源锚点：统一成 `evidence:<id>`，报告里可回溯到具体上传资料。 */
export function evidenceRefOf(evidenceId: string): string {
  return `evidence:${evidenceId}`;
}

/**
 * ① 规格块：SPEC 行 → result.deep.spec
 *
 * value 取资料里的规格描述；资料没给规格时写 "—" 显式标缺（不猜、不填占位数字）。
 * claimKind 一律 FACT：这些数字来自供应商资料本身，不是推断。
 */
export function buildDeepSpecFromQuotes(
  quotes: readonly LoadedQuote[]
): ExecutiveReportDeepSpec | undefined {
  const rows = quotes.slice(0, DEEP_SPEC_ROWS_CAP).map((quote) => ({
    name: quote.item,
    value: quote.spec ?? MISSING_MARK,
    unit: quote.uom ?? undefined,
    note: quote.note ?? undefined,
    claimKind: "FACT" as const,
    evidenceRef: evidenceRefOf(quote.evidenceId),
  }));
  if (rows.length === 0) return undefined;
  return { rows };
}

/**
 * ② BOM 块：PRICE 行 → result.deep.bom
 *
 * 只给**真实报价里有的**字段：单价照抄，行合计一律 "—" ——
 * 报价单没有用量（qty），算合计就必须假设用量，那是编不是算。
 */
export function buildDeepBomFromQuotes(
  quotes: readonly LoadedQuote[]
): ExecutiveReportDeepBom | undefined {
  const lines = quotes.slice(0, DEEP_BOM_LINES_CAP).map((quote) => ({
    item: quote.item,
    uom: quote.uom ?? undefined,
    unitCost: quote.unitPrice ?? MISSING_MARK,
    total: MISSING_MARK,
    sourceRef: evidenceRefOf(quote.evidenceId),
    note: quote.moq ? `MOQ ${quote.moq}` : quote.note ?? undefined,
  }));
  if (lines.length === 0) return undefined;
  const priced = quotes.filter((q) => q.unitPrice !== null && q.unitPrice !== undefined);
  return {
    currency: quotes[0]?.currency ?? "CNY",
    basis:
      `来自 ${quotes.length} 条真实供应商报价（其中 ${priced.length} 条含单价）；` +
      `无用量依据，故不给出行合计。`,
    lines,
  };
}

// ---------------------------------------------------------------------------
// 数据访问（仅供路由层调用；app 层不再直连数据库，见架构守卫 AL3）
// ---------------------------------------------------------------------------

/**
 * 可录入报价的项目角色：与附件上传口对齐 —— 能往项目里写资料的角色即可录入报价。
 * 收在模块层而非路由里，因为 app 层不得 import `@prisma/client`（AL3 同样拦截）。
 */
export const QUOTE_WRITE_ROLES: Role[] = [
  Role.OWNER,
  Role.DECISION_MAKER,
  Role.FEEDBACK_PROVIDER,
];

/** 可删除他人报价行的角色：破坏性操作，非创建者须为项目 OWNER。 */
export const QUOTE_DELETE_OVERRIDE_ROLES: Role[] = [Role.OWNER];

/** 列表查询（GET）：项目下已入库行 + 来源资料摘要。 */
export async function listProjectQuotes(params: {
  projectId: string;
  organizationId: string;
  kind?: SupplierQuoteKindValue;
}) {
  return prisma.supplierQuote.findMany({
    where: {
      projectId: params.projectId,
      organizationId: params.organizationId,
      ...(params.kind ? { kind: params.kind as SupplierQuoteKind } : {}),
    },
    include: {
      evidence: {
        select: {
          id: true,
          source: true,
          nature: true,
          verifyStatus: true,
          originalFilename: true,
        },
      },
    },
    orderBy: [{ quotedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

/**
 * 录入（POST）：入参校验 → 锚定资料 → 事务落库 + 记审计。
 *
 * 两处顺序是刻意的：
 * - **行校验先于资料归属校验**：入参形态错误与资源是否存在是两回事，
 *   先把调用方能改的错一次性说清（消息带行号）。
 * - **审计与落库同事务**：避免「写了行却没留痕」——报价行是报告 ①② 块的唯一真实来源，
 *   留痕缺失会让回溯断链。
 */
export async function ingestQuoteRows(params: {
  organizationId: string;
  projectId: string;
  userId: string;
  evidenceId?: unknown;
  kind?: unknown;
  rows: unknown;
}) {
  const { organizationId, projectId, userId } = params;

  if (typeof params.evidenceId !== "string" || !params.evidenceId.trim()) {
    throw new UnprocessableEntityError(
      "缺少 evidenceId：报价行必须锚定一条已上传的真实资料（先调 POST /api/projects/{id}/attachments）"
    );
  }
  if (!isSupplierQuoteKind(params.kind)) {
    throw new UnprocessableEntityError("kind 非法，允许值：SPEC / PRICE");
  }
  const kind = params.kind;
  const normalized = normalizeQuoteRows(params.rows);

  // 跨项目 / 跨组织借用他人资料一律按不存在处理（404 而非 403），不泄露存在性。
  const evidence = await prisma.evidence.findFirst({
    where: {
      id: params.evidenceId.trim(),
      projectId,
      project: { organizationId },
    },
    select: { id: true },
  });
  if (!evidence) {
    throw new NotFoundError("Evidence not found in this project");
  }

  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const row of normalized) {
      created.push(
        await tx.supplierQuote.create({
          data: {
            organizationId,
            projectId,
            evidenceId: evidence.id,
            kind: kind as SupplierQuoteKind,
            supplier: row.supplier ?? null,
            item: row.item,
            spec: row.spec ?? null,
            uom: row.uom ?? null,
            moq: row.moq ?? null,
            unitPrice: row.unitPrice ?? null,
            currency: row.currency ?? "CNY",
            quotedAt: row.quotedAt ?? null,
            note: row.note ?? null,
            createdById: userId,
          },
        })
      );
    }
    await createAuditEventInTx(tx, {
      actorId: userId,
      action: "SUPPLIER_QUOTE_INGESTED",
      objectType: "SupplierQuote",
      objectId: evidence.id,
      summary: `从资料 ${evidence.id} 结构化录入 ${created.length} 条${kind === "SPEC" ? "规格" : "报价"}行`,
    });
    return created;
  });
}

/** 删除前定位：跨组织一律返回 null（路由据此 404，不泄露存在性）。 */
export async function findSupplierQuoteOwnership(id: string, organizationId: string) {
  const quote = await prisma.supplierQuote.findUnique({
    where: { id },
    select: { id: true, organizationId: true, projectId: true, createdById: true },
  });
  if (!quote || quote.organizationId !== organizationId) return null;
  return quote;
}

/** 删除（DELETE）：创建者本人 / 项目 OWNER 的鉴权由路由完成，这里只落删除。 */
export async function deleteSupplierQuote(id: string): Promise<void> {
  await prisma.supplierQuote.delete({ where: { id } });
}
