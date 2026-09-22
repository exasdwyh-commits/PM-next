import crypto from "node:crypto";
import {
  ChannelRuleRecordStatus,
  ChannelSpecRouteStatus,
  Prisma,
} from "@prisma/client";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import {
  PRODUCT_WRITE_ROLES,
  hasProductRole,
  requireProductRead,
  requireProductRole,
} from "@/modules/identity/product-access";
import { isOrgAdmin } from "@/modules/identity/admin";
import {
  evaluateChannelSpecCandidate,
  type ChannelRuleProfile,
  type ChannelSpecEvaluation,
} from "./channel-spec";
import {
  assessProductPotential,
  PRODUCT_POTENTIAL_RULE_VERSION,
  type PotentialDimensionInput,
  type PotentialGateInput,
  type ProductPotentialAssessment,
} from "./potential-assessment";

const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const GENERIC_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const POTENTIAL_DIMENSION_KEYS = new Set([
  "DEMAND",
  "CHANNEL_FIT",
  "UNIT_ECONOMICS",
  "DIFFERENTIATION",
  "REPEAT_PURCHASE",
  "DELIVERY_FEASIBILITY",
  "COMPANY_FIT",
]);
const EVIDENCE_STATES = new Set([
  "VERIFIED",
  "SUPPORTED",
  "ASSUMED",
  "UNKNOWN",
]);
const GATE_STATUSES = new Set(["PASS", "FAIL", "UNKNOWN"]);

function requireKey(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!KEY_RE.test(text)) {
    throw new UnprocessableEntityError(
      `${label} 仅允许 2-64 位小写字母、数字、-、_`
    );
  }
  return text;
}

function requireGenericKey(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!GENERIC_KEY_RE.test(text)) {
    throw new UnprocessableEntityError(
      `${label} 仅允许 2-64 位字母、数字、-、_`
    );
  }
  return text;
}

function requireText(value: unknown, label: string, max = 160): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new UnprocessableEntityError(`${label} 不能为空`);
  if (text.length > max) {
    throw new UnprocessableEntityError(`${label} 过长`);
  }
  return text;
}

function optionalText(value: unknown, max = 500): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) {
    throw new UnprocessableEntityError("文本字段过长");
  }
  return text;
}

function requireNumber(
  value: unknown,
  label: string,
  options?: { min?: number; max?: number; integer?: boolean }
): number {
  if (value === "" || value === null || value === undefined) {
    throw new UnprocessableEntityError(`${label} 不能为空`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new UnprocessableEntityError(`${label} 必须是有效数字`);
  }
  if (options?.integer && !Number.isInteger(number)) {
    throw new UnprocessableEntityError(`${label} 必须是整数`);
  }
  if (options?.min !== undefined && number < options.min) {
    throw new UnprocessableEntityError(
      `${label} 不能小于 ${options.min}`
    );
  }
  if (options?.max !== undefined && number > options.max) {
    throw new UnprocessableEntityError(
      `${label} 不能大于 ${options.max}`
    );
  }
  return number;
}

function optionalNumber(
  value: unknown,
  label: string,
  options?: { min?: number; max?: number; integer?: boolean }
): number | null {
  if (value === "" || value === null || value === undefined) return null;
  return requireNumber(value, label, options);
}

function stringArray(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new UnprocessableEntityError(`${label} 必须是数组`);
  }
  return [...new Set(
    value
      .map((item) => String(item).trim())
      .filter(Boolean)
  )].slice(0, 100);
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseDate(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityError(`${label} 日期格式无效`);
  }
  return parsed;
}

export function isChannelRuleEffectiveAt(
  rule: { effectiveFrom?: Date | null; effectiveUntil?: Date | null },
  at: Date = new Date()
): boolean {
  const timestamp = at.getTime();
  if (rule.effectiveFrom && rule.effectiveFrom.getTime() > timestamp) return false;
  if (rule.effectiveUntil && rule.effectiveUntil.getTime() < timestamp) return false;
  return true;
}

function routeStatusForEvaluation(
  evaluation: ChannelSpecEvaluation,
  ruleEffective: boolean
): ChannelSpecRouteStatus {
  if (!evaluation.feasible) return ChannelSpecRouteStatus.BLOCKED;
  return evaluation.ruleStatus === "CONFIRMED" && ruleEffective
    ? ChannelSpecRouteStatus.VALIDATION_READY
    : ChannelSpecRouteStatus.DRAFT;
}

function normalizedChannelTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];
  return [...new Set([
    normalized,
    ...normalized
      .split(/[,、;；|/]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ])];
}

export function deriveMarketValidationVerified(params: {
  evidence: Array<{
    nature: string;
    verifyStatus: string;
    validationStatus: string;
    channel: string | null;
  }>;
  routeChannel?: { channelKey: string; label: string } | null;
}): boolean {
  const routeTokens = params.routeChannel
    ? new Set([
        ...normalizedChannelTokens(params.routeChannel.channelKey),
        ...normalizedChannelTokens(params.routeChannel.label),
      ])
    : null;

  return params.evidence.some((evidence) => {
    if (
      evidence.nature !== "REAL" ||
      evidence.verifyStatus !== "VERIFIED" ||
      evidence.validationStatus !== "VERIFIED_BY_LEAD"
    ) {
      return false;
    }
    if (!routeTokens) return true;
    const evidenceTokens = normalizedChannelTokens(evidence.channel);
    return evidenceTokens.some((token) => routeTokens.has(token));
  });
}

export function validatePotentialDimensionEvidence(
  dimensions: PotentialDimensionInput[],
  evidenceRows: Array<{
    id: string;
    hash: string;
    nature: string;
    verifyStatus: string;
    channel?: string | null;
  }>,
  routeChannel?: { channelKey: string; label: string } | null
): void {
  const verifiedEvidence = evidenceRows.filter(
    (evidence) =>
      evidence.nature === "REAL" &&
      evidence.verifyStatus === "VERIFIED"
  );
  const verifiedEvidenceRefs = new Set(
    verifiedEvidence.flatMap((evidence) => [
      evidence.id,
      evidence.hash,
      `evidence:${evidence.id}`,
    ])
  );
  const routeTokens = routeChannel
    ? new Set([
        ...normalizedChannelTokens(routeChannel.channelKey),
        ...normalizedChannelTokens(routeChannel.label),
      ])
    : null;
  const routeVerifiedRefs = new Set(
    routeTokens
      ? verifiedEvidence
          .filter((evidence) =>
            normalizedChannelTokens(evidence.channel).some((token) =>
              routeTokens.has(token)
            )
          )
          .flatMap((evidence) => [
            evidence.id,
            evidence.hash,
            `evidence:${evidence.id}`,
          ])
      : []
  );

  for (const dimension of dimensions) {
    if (
      (dimension.evidenceState === "VERIFIED" ||
        dimension.evidenceState === "SUPPORTED") &&
      dimension.sourceRefs.length === 0
    ) {
      throw new UnprocessableEntityError(
        `维度 ${dimension.key} 标记为 ${dimension.evidenceState} 时必须提供 sourceRefs`
      );
    }
    if (
      dimension.evidenceState === "VERIFIED" &&
      !dimension.sourceRefs.some((ref) => verifiedEvidenceRefs.has(ref))
    ) {
      throw new UnprocessableEntityError(
        `维度 ${dimension.key} 标记为 VERIFIED 时，至少一个 sourceRef 必须对应当前产品已核实的 REAL Evidence（支持 evidenceId / hash / evidence:<id>）`
      );
    }
    if (
      routeTokens &&
      dimension.key === "CHANNEL_FIT" &&
      dimension.evidenceState === "VERIFIED" &&
      !dimension.sourceRefs.some((ref) => routeVerifiedRefs.has(ref))
    ) {
      throw new UnprocessableEntityError(
        "路线级 CHANNEL_FIT 标记为 VERIFIED 时，至少一个 sourceRef 必须来自与该路线匹配的渠道 Evidence"
      );
    }
  }
}

export function planChannelRuleSupersession(params: {
  nextStatus: "ASSUMED" | "CONFIRMED";
  activeRules: Array<{ id: string; status: ChannelRuleRecordStatus | string }>;
}): { supersedesId: string | null; supersededIds: string[] } {
  const currentConfirmed = params.activeRules.find(
    (rule) => rule.status === ChannelRuleRecordStatus.CONFIRMED
  );
  const currentAssumed = params.activeRules.find(
    (rule) => rule.status === ChannelRuleRecordStatus.ASSUMED
  );

  if (params.nextStatus === "ASSUMED") {
    return {
      supersedesId: currentAssumed?.id || null,
      supersededIds: currentAssumed ? [currentAssumed.id] : [],
    };
  }

  return {
    supersedesId: currentConfirmed?.id || currentAssumed?.id || null,
    supersededIds: params.activeRules
      .filter((rule) => rule.status !== ChannelRuleRecordStatus.SUPERSEDED)
      .map((rule) => rule.id),
  };
}

export function buildChannelHardGates(params: {
  route: {
    feasible: boolean;
    ruleStatusSnapshot: ChannelRuleRecordStatus | string;
    ruleVersionSnapshot: string;
  };
  currentRuleStatus?: ChannelRuleRecordStatus | string | null;
  currentRuleEffective?: boolean;
}): PotentialGateInput[] {
  const economics: PotentialGateInput = {
    key: "CHANNEL_ROUTE_ECONOMICS",
    label: "渠道规格经济性",
    status: params.route.feasible ? "PASS" : "FAIL",
    reason: params.route.feasible
      ? "当前保存路线通过确定性渠道经济性校验"
      : "当前保存路线存在渠道经济性或规格硬阻断",
    sourceRefs: [],
  };

  let ruleStatus: PotentialGateInput["status"] = "UNKNOWN";
  let ruleReason =
    `渠道规则 ${params.route.ruleVersionSnapshot} 尚未被负责人确认`;

  if (
    params.route.ruleStatusSnapshot === ChannelRuleRecordStatus.CONFIRMED &&
    params.currentRuleStatus === ChannelRuleRecordStatus.CONFIRMED &&
    params.currentRuleEffective !== false
  ) {
    ruleStatus = "PASS";
    ruleReason =
      `渠道规则 ${params.route.ruleVersionSnapshot} 为已确认且仍在生效窗口的规则版本`;
  } else if (params.currentRuleStatus === ChannelRuleRecordStatus.SUPERSEDED) {
    ruleReason =
      `渠道规则 ${params.route.ruleVersionSnapshot} 已被新版本替代，需要重新评估路线`;
  } else if (
    params.currentRuleStatus === ChannelRuleRecordStatus.CONFIRMED &&
    params.currentRuleEffective === false
  ) {
    ruleReason =
      `渠道规则 ${params.route.ruleVersionSnapshot} 不在当前生效窗口，需要重新确认渠道条件`;
  }

  return [
    economics,
    {
      key: "CHANNEL_RULE_CONFIDENCE",
      label: "渠道规则可信状态",
      status: ruleStatus,
      reason: ruleReason,
      sourceRefs: [],
    },
  ];
}

function mergeSystemGates(
  userGates: PotentialGateInput[],
  systemGates: PotentialGateInput[]
): PotentialGateInput[] {
  const systemKeys = new Set(systemGates.map((gate) => gate.key));
  return [
    ...userGates.filter((gate) => !systemKeys.has(gate.key)),
    ...systemGates,
  ];
}

function parseDimensions(value: unknown): PotentialDimensionInput[] {
  if (!Array.isArray(value)) {
    throw new UnprocessableEntityError("dimensions 必须是数组");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UnprocessableEntityError(
        `dimensions[${index}] 格式错误`
      );
    }
    const row = item as Record<string, unknown>;
    const key = String(row.key || "");
    const evidenceState = String(row.evidenceState || "");
    if (!POTENTIAL_DIMENSION_KEYS.has(key)) {
      throw new UnprocessableEntityError(`未知潜力维度：${key}`);
    }
    if (!EVIDENCE_STATES.has(evidenceState)) {
      throw new UnprocessableEntityError(
        `维度 ${key} 的 evidenceState 非法`
      );
    }
    const score =
      row.score === null || row.score === undefined || row.score === ""
        ? null
        : requireNumber(row.score, `${key}.score`, { min: 0, max: 100 });

    return {
      key: key as PotentialDimensionInput["key"],
      score,
      evidenceState: evidenceState as PotentialDimensionInput["evidenceState"],
      rationale:
        typeof row.rationale === "string" ? row.rationale.trim().slice(0, 2000) : "",
      sourceRefs: stringArray(row.sourceRefs, `${key}.sourceRefs`),
    };
  });
}

function parseGates(value: unknown): PotentialGateInput[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new UnprocessableEntityError("gates 必须是数组");
  }

  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UnprocessableEntityError(`gates[${index}] 格式错误`);
    }
    const row = item as Record<string, unknown>;
    const key = requireGenericKey(row.key, `gates[${index}].key`);
    if (seen.has(key)) {
      throw new UnprocessableEntityError(`硬门槛重复：${key}`);
    }
    seen.add(key);
    const status = String(row.status || "");
    if (!GATE_STATUSES.has(status)) {
      throw new UnprocessableEntityError(`门槛 ${key} 的 status 非法`);
    }

    return {
      key,
      label: requireText(row.label, `gates[${index}].label`, 120),
      status: status as PotentialGateInput["status"],
      reason:
        typeof row.reason === "string" ? row.reason.trim().slice(0, 2000) : "",
      sourceRefs: stringArray(row.sourceRefs, `${key}.sourceRefs`),
    };
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(row)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(row[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function evidenceFingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function loadProductVersion(
  session: SessionContext,
  productId: string,
  productVersionId?: string | null
) {
  const version = productVersionId
    ? await prisma.productVersion.findFirst({
        where: {
          id: productVersionId,
          product: {
            id: productId,
            organizationId: session.organizationId,
          },
        },
        include: { product: { select: { id: true, name: true } } },
      })
    : await prisma.productVersion.findFirst({
        where: {
          product: {
            id: productId,
            organizationId: session.organizationId,
          },
        },
        orderBy: { createdAt: "desc" },
        include: { product: { select: { id: true, name: true } } },
      });

  if (!version) {
    throw new NotFoundError("ProductVersion not found");
  }
  return version;
}

export async function listChannelRouteWorkspace(
  session: SessionContext,
  productId: string
) {
  await requireProductRead(session, productId);
  const version = await loadProductVersion(session, productId);

  const [rules, routes, assessments, verifiedEvidence, canManageRules, canEditRoutes] = await Promise.all([
    prisma.channelRuleProfileRecord.findMany({
      where: {
        organizationId: session.organizationId,
        status: { not: ChannelRuleRecordStatus.SUPERSEDED },
      },
      orderBy: [{ channelKey: "asc" }, { createdAt: "desc" }],
    }),
    prisma.channelSpecRoute.findMany({
      where: {
        organizationId: session.organizationId,
        productVersionId: version.id,
        status: { not: ChannelSpecRouteStatus.SUPERSEDED },
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        channelRuleProfile: {
          select: {
            channelKey: true,
            label: true,
            version: true,
            status: true,
            effectiveFrom: true,
            effectiveUntil: true,
          },
        },
      },
    }),
    prisma.potentialAssessmentRecord.findMany({
      where: {
        organizationId: session.organizationId,
        productVersionId: version.id,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        channelRoute: {
          select: {
            id: true,
            name: true,
            routeKey: true,
            revision: true,
            status: true,
          },
        },
      },
    }),
    prisma.evidence.findMany({
      where: {
        project: {
          productId,
          organizationId: session.organizationId,
        },
        nature: "REAL",
        verifyStatus: "VERIFIED",
      },
      orderBy: { obtainedAt: "desc" },
      take: 30,
      select: {
        id: true,
        hash: true,
        source: true,
        channel: true,
        contentOrUri: true,
        validationStatus: true,
        obtainedAt: true,
      },
    }),
    isOrgAdmin(session),
    hasProductRole(session, productId, PRODUCT_WRITE_ROLES),
  ]);

  return {
    product: version.product,
    currentVersion: {
      id: version.id,
      versionTag: version.versionTag,
      targetCost: version.targetCost,
      currency: version.currency,
      isConfirmed: version.isConfirmed,
    },
    rules: [...rules].sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === ChannelRuleRecordStatus.CONFIRMED) return -1;
        if (b.status === ChannelRuleRecordStatus.CONFIRMED) return 1;
      }
      const channelCompare = a.channelKey.localeCompare(b.channelKey);
      if (channelCompare !== 0) return channelCompare;
      return b.createdAt.getTime() - a.createdAt.getTime();
    }),
    routes: routes.map((route) => {
      const ruleCurrentlyEffective = isChannelRuleEffectiveAt(
        route.channelRuleProfile
      );
      return {
        ...route,
        ruleCurrentlyEffective,
        needsReevaluation:
          route.channelRuleProfile.status ===
            ChannelRuleRecordStatus.SUPERSEDED ||
          !ruleCurrentlyEffective,
      };
    }),
    assessments,
    verifiedEvidence,
    canManageRules,
    canEditRoutes,
  };
}

export async function createChannelRuleProfile(
  session: SessionContext,
  input: Record<string, unknown>
) {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError("渠道规则属于组织级资产，仅组织管理员可维护");
  }

  const channelKey = requireKey(input.channelKey, "channelKey");
  const label = requireText(input.label, "渠道名称", 120);
  const version = requireText(input.version, "规则版本", 80);
  const statusText = String(input.status || "ASSUMED");
  if (!["ASSUMED", "CONFIRMED"].includes(statusText)) {
    throw new UnprocessableEntityError(
      "新渠道规则 status 只能是 ASSUMED 或 CONFIRMED"
    );
  }
  const status = statusText as "ASSUMED" | "CONFIRMED";
  const sourceRefs = stringArray(input.sourceRefs, "sourceRefs");
  if (status === "CONFIRMED" && sourceRefs.length === 0) {
    throw new UnprocessableEntityError(
      "CONFIRMED 渠道规则至少需要一个来源引用"
    );
  }

  const minRetailPrice = optionalNumber(input.minRetailPrice, "最低零售价", {
    min: 0,
  });
  const maxRetailPrice = optionalNumber(input.maxRetailPrice, "最高零售价", {
    min: 0,
  });
  if (
    minRetailPrice !== null &&
    maxRetailPrice !== null &&
    minRetailPrice > maxRetailPrice
  ) {
    throw new UnprocessableEntityError("最低零售价不能高于最高零售价");
  }

  const minBundleQuantity = optionalNumber(
    input.minBundleQuantity,
    "最小组合数量",
    { min: 1, integer: true }
  );
  const maxBundleQuantity = optionalNumber(
    input.maxBundleQuantity,
    "最大组合数量",
    { min: 1, integer: true }
  );
  if (
    minBundleQuantity !== null &&
    maxBundleQuantity !== null &&
    minBundleQuantity > maxBundleQuantity
  ) {
    throw new UnprocessableEntityError("最小组合数量不能高于最大组合数量");
  }

  const rate = (key: string, labelText: string) =>
    requireNumber(input[key], labelText, { min: 0, max: 100 });

  const effectiveFrom = parseDate(input.effectiveFrom, "effectiveFrom");
  const effectiveUntil = parseDate(input.effectiveUntil, "effectiveUntil");
  if (
    effectiveFrom &&
    effectiveUntil &&
    effectiveFrom.getTime() > effectiveUntil.getTime()
  ) {
    throw new UnprocessableEntityError(
      "effectiveFrom 不能晚于 effectiveUntil"
    );
  }

  return prisma.$transaction(async (tx) => {
    const existingVersion = await tx.channelRuleProfileRecord.findUnique({
      where: {
        organizationId_channelKey_version: {
          organizationId: session.organizationId,
          channelKey,
          version,
        },
      },
    });
    if (existingVersion) {
      throw new UnprocessableEntityError(
        `渠道 ${channelKey} 的规则版本 ${version} 已存在`
      );
    }

    const activeRules = await tx.channelRuleProfileRecord.findMany({
      where: {
        organizationId: session.organizationId,
        channelKey,
        status: { not: ChannelRuleRecordStatus.SUPERSEDED },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    const supersession = planChannelRuleSupersession({
      nextStatus: status,
      activeRules,
    });

    if (supersession.supersededIds.length > 0) {
      await tx.channelRuleProfileRecord.updateMany({
        where: { id: { in: supersession.supersededIds } },
        data: { status: ChannelRuleRecordStatus.SUPERSEDED },
      });
    }

    const created = await tx.channelRuleProfileRecord.create({
      data: {
        organizationId: session.organizationId,
        channelKey,
        label,
        version,
        status,
        sourceRefs: sourceRefs as Prisma.InputJsonValue,
        minRetailPrice,
        maxRetailPrice,
        minBundleQuantity,
        maxBundleQuantity,
        allowedUnitLabels: stringArray(
          input.allowedUnitLabels,
          "allowedUnitLabels"
        ) as Prisma.InputJsonValue,
        commissionRate: rate("commissionRate", "佣金率"),
        platformFeeRate: rate("platformFeeRate", "平台费率"),
        marketingRate: rate("marketingRate", "推广费率"),
        managementFeeRate: rate("managementFeeRate", "管理费率"),
        returnRate: rate("returnRate", "退货率"),
        returnHandlingFeeRate: rate(
          "returnHandlingFeeRate",
          "退货处理费率"
        ),
        targetContributionMarginRate: rate(
          "targetContributionMarginRate",
          "目标贡献毛利率"
        ),
        constraints: stringArray(
          input.constraints,
          "constraints"
        ) as Prisma.InputJsonValue,
        effectiveFrom,
        effectiveUntil,
        supersedesId: supersession.supersedesId,
        createdById: session.userId,
        confirmedById: status === "CONFIRMED" ? session.userId : null,
        confirmedAt: status === "CONFIRMED" ? new Date() : null,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "CHANNEL_RULE_PROFILE_CREATED",
      objectType: "ChannelRuleProfileRecord",
      objectId: created.id,
      summary: `创建渠道规则 ${label} / ${version}（${status}）`,
      details: {
        channelKey,
        version,
        status,
        sourceRefs,
        supersedesId: supersession.supersedesId,
      } as Prisma.InputJsonValue,
    });

    return created;
  });
}

type ChannelRuleRow = Prisma.ChannelRuleProfileRecordGetPayload<{}>;

function toChannelRuleProfile(
  row: ChannelRuleRow
): ChannelRuleProfile {
  if (row.status === ChannelRuleRecordStatus.SUPERSEDED) {
    throw new UnprocessableEntityError(
      "所选渠道规则已被新版本替代，请改用当前规则"
    );
  }

  return {
    key: row.channelKey,
    label: row.label,
    version: row.version,
    status: row.status,
    sourceRefs: jsonStringArray(row.sourceRefs),
    minRetailPrice:
      row.minRetailPrice == null ? null : Number(row.minRetailPrice),
    maxRetailPrice:
      row.maxRetailPrice == null ? null : Number(row.maxRetailPrice),
    minBundleQuantity: row.minBundleQuantity,
    maxBundleQuantity: row.maxBundleQuantity,
    allowedUnitLabels: jsonStringArray(row.allowedUnitLabels),
    commissionRate: Number(row.commissionRate),
    platformFeeRate: Number(row.platformFeeRate),
    marketingRate: Number(row.marketingRate),
    managementFeeRate: Number(row.managementFeeRate),
    returnRate: Number(row.returnRate),
    returnHandlingFeeRate: Number(row.returnHandlingFeeRate),
    targetContributionMarginRate: Number(
      row.targetContributionMarginRate
    ),
    constraints: jsonStringArray(row.constraints),
  };
}

export async function evaluateAndSaveChannelRoute(
  session: SessionContext,
  productId: string,
  input: Record<string, unknown>
) {
  await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);

  const version = await loadProductVersion(
    session,
    productId,
    optionalText(input.productVersionId, 120)
  );
  const ruleId = requireText(input.channelRuleProfileId, "渠道规则", 120);
  const routeKey = requireKey(input.routeKey, "routeKey");
  const name = requireText(input.name, "路线名称", 160);

  const ruleRow = await prisma.channelRuleProfileRecord.findFirst({
    where: {
      id: ruleId,
      organizationId: session.organizationId,
      status: { not: ChannelRuleRecordStatus.SUPERSEDED },
    },
  });
  if (!ruleRow) throw new NotFoundError("Channel rule not found");

  const candidate = {
    id: routeKey,
    retailPrice: requireNumber(input.retailPrice, "零售价", { min: 0.01 }),
    bundleQuantity: requireNumber(input.bundleQuantity, "组合数量", {
      min: 1,
      integer: true,
    }),
    unitLabel: requireText(input.unitLabel, "售卖单位", 80),
    productCostPerUnit: requireNumber(
      input.productCostPerUnit,
      "单元产品成本",
      { min: 0 }
    ),
    packagingCostPerOrder: requireNumber(
      input.packagingCostPerOrder,
      "订单包装成本",
      { min: 0 }
    ),
    freightCostPerOrder: requireNumber(
      input.freightCostPerOrder,
      "订单运费",
      { min: 0 }
    ),
  };

  const baseEvaluation = evaluateChannelSpecCandidate(
    candidate,
    toChannelRuleProfile(ruleRow)
  );
  const ruleEffective = isChannelRuleEffectiveAt(ruleRow);
  const evaluation: ChannelSpecEvaluation = ruleEffective
    ? baseEvaluation
    : {
        ...baseEvaluation,
        warnings: [
          ...baseEvaluation.warnings,
          "当前渠道规则不在生效时间窗口，经济性结果可保留但路线不能视为验证就绪",
        ],
      };
  const status = routeStatusForEvaluation(evaluation, ruleEffective);

  return prisma.$transaction(async (tx) => {
    const previous = await tx.channelSpecRoute.findFirst({
      where: {
        productVersionId: version.id,
        routeKey,
        status: { not: ChannelSpecRouteStatus.SUPERSEDED },
      },
      orderBy: { revision: "desc" },
    });
    const revision = (previous?.revision ?? 0) + 1;

    const route = await tx.channelSpecRoute.create({
      data: {
        organizationId: session.organizationId,
        productVersionId: version.id,
        channelRuleProfileId: ruleRow.id,
        routeKey,
        revision,
        name,
        status,
        retailPrice: candidate.retailPrice,
        bundleQuantity: candidate.bundleQuantity,
        unitLabel: candidate.unitLabel,
        packageSpec: optionalText(input.packageSpec, 500),
        productCostPerUnit: candidate.productCostPerUnit,
        packagingCostPerOrder: candidate.packagingCostPerOrder,
        freightCostPerOrder: candidate.freightCostPerOrder,
        currency: version.currency || "CNY",
        ruleStatusSnapshot: ruleRow.status,
        ruleVersionSnapshot: ruleRow.version,
        evaluationSnapshot: evaluation as unknown as Prisma.InputJsonValue,
        feasible: evaluation.feasible,
        blockerCount: evaluation.blockers.length,
        contributionMarginRate: evaluation.contributionMarginRate,
        requiredMaxProductCostPerUnit:
          evaluation.requiredMaxProductCostPerUnit,
        supersedesId: previous?.id || null,
        createdById: session.userId,
      },
    });

    if (previous) {
      await tx.channelSpecRoute.update({
        where: { id: previous.id },
        data: { status: ChannelSpecRouteStatus.SUPERSEDED },
      });
    }

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "CHANNEL_SPEC_ROUTE_EVALUATED",
      objectType: "ChannelSpecRoute",
      objectId: route.id,
      summary: `评估渠道路线 ${name} r${revision}：${evaluation.feasible ? "经济性通过" : "存在硬阻断"}`,
      details: {
        productId,
        productVersionId: version.id,
        routeKey,
        revision,
        channelKey: ruleRow.channelKey,
        ruleVersion: ruleRow.version,
        ruleStatus: ruleRow.status,
        feasible: evaluation.feasible,
        blockers: evaluation.blockers,
        contributionMarginRate: evaluation.contributionMarginRate,
        requiredMaxProductCostPerUnit:
          evaluation.requiredMaxProductCostPerUnit,
      } as Prisma.InputJsonValue,
    });

    return route;
  });
}

export async function assessAndSaveProductPotential(
  session: SessionContext,
  productId: string,
  input: Record<string, unknown>
) {
  await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);

  const version = await loadProductVersion(
    session,
    productId,
    optionalText(input.productVersionId, 120)
  );
  const dimensions = parseDimensions(input.dimensions);
  const userGates = parseGates(input.gates);

  const routeId = optionalText(input.channelRouteId, 120);
  const route = routeId
    ? await prisma.channelSpecRoute.findFirst({
        where: {
          id: routeId,
          organizationId: session.organizationId,
          productVersionId: version.id,
          status: { not: ChannelSpecRouteStatus.SUPERSEDED },
        },
        include: {
          channelRuleProfile: {
            select: {
              status: true,
              channelKey: true,
              label: true,
              effectiveFrom: true,
              effectiveUntil: true,
            },
          },
        },
      })
    : null;

  if (routeId && !route) {
    throw new NotFoundError("Channel route not found");
  }

  const evidenceRows = await prisma.evidence.findMany({
    where: {
      project: {
        productId,
        organizationId: session.organizationId,
      },
    },
    select: {
      id: true,
      hash: true,
      nature: true,
      verifyStatus: true,
      validationStatus: true,
      infoDate: true,
      channel: true,
      productRef: true,
    },
    orderBy: { id: "asc" },
  });

  validatePotentialDimensionEvidence(
    dimensions,
    evidenceRows,
    route
      ? {
          channelKey: route.channelRuleProfile.channelKey,
          label: route.channelRuleProfile.label,
        }
      : null
  );

  const marketValidationVerified = deriveMarketValidationVerified({
    evidence: evidenceRows,
    routeChannel: route
      ? {
          channelKey: route.channelRuleProfile.channelKey,
          label: route.channelRuleProfile.label,
        }
      : null,
  });

  const systemGates = route
    ? buildChannelHardGates({
        route: {
          feasible: route.feasible,
          ruleStatusSnapshot: route.ruleStatusSnapshot,
          ruleVersionSnapshot: route.ruleVersionSnapshot,
        },
        currentRuleStatus: route.channelRuleProfile.status,
        currentRuleEffective: isChannelRuleEffectiveAt(
          route.channelRuleProfile
        ),
      })
    : [];

  const gates = mergeSystemGates(userGates, systemGates);
  const assessment: ProductPotentialAssessment = assessProductPotential({
    dimensions,
    gates,
    marketValidationVerified,
  });

  const fingerprint = evidenceFingerprint({
    productVersionId: version.id,
    channelRouteId: route?.id || null,
    evidence: evidenceRows.map((evidence) => ({
      id: evidence.id,
      hash: evidence.hash,
      nature: evidence.nature,
      verifyStatus: evidence.verifyStatus,
      validationStatus: evidence.validationStatus,
      infoDate: evidence.infoDate?.toISOString() || null,
      channel: evidence.channel,
      productRef: evidence.productRef,
    })),
  });

  return prisma.$transaction(async (tx) => {
    const previous = await tx.potentialAssessmentRecord.findFirst({
      where: {
        organizationId: session.organizationId,
        productVersionId: version.id,
        ...(route
          ? {
              channelRoute: {
                productVersionId: version.id,
                routeKey: route.routeKey,
              },
            }
          : { channelRouteId: null }),
      },
      orderBy: { createdAt: "desc" },
    });

    const created = await tx.potentialAssessmentRecord.create({
      data: {
        organizationId: session.organizationId,
        productVersionId: version.id,
        channelRouteId: route?.id || null,
        ruleVersion: PRODUCT_POTENTIAL_RULE_VERSION,
        dimensionSnapshot: dimensions as unknown as Prisma.InputJsonValue,
        gateSnapshot: gates as unknown as Prisma.InputJsonValue,
        evidenceFingerprint: fingerprint,
        marketValidationVerified,
        verdict: assessment.verdict,
        diagnosticIndex: assessment.diagnosticIndex,
        coverageRatio: assessment.coverageRatio,
        verifiedCoverageRatio: assessment.verifiedCoverageRatio,
        confidenceBand: assessment.confidenceBand,
        reasons: assessment.reasons as Prisma.InputJsonValue,
        blockers: assessment.blockers as unknown as Prisma.InputJsonValue,
        unknownGates:
          assessment.unknownGates as unknown as Prisma.InputJsonValue,
        supersedesId: previous?.id || null,
        createdById: session.userId,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCT_POTENTIAL_ASSESSED",
      objectType: "PotentialAssessmentRecord",
      objectId: created.id,
      summary: `保存产品潜力评估：${assessment.verdict}`,
      details: {
        productId,
        productVersionId: version.id,
        channelRouteId: route?.id || null,
        verdict: assessment.verdict,
        diagnosticIndex: assessment.diagnosticIndex,
        coverageRatio: assessment.coverageRatio,
        verifiedCoverageRatio: assessment.verifiedCoverageRatio,
        confidenceBand: assessment.confidenceBand,
        marketValidationVerified,
        evidenceFingerprint: fingerprint,
        supersedesId: previous?.id || null,
      } as Prisma.InputJsonValue,
    });

    return {
      record: created,
      assessment,
      marketValidationVerified,
      evidenceFingerprint: fingerprint,
    };
  });
}


const ROUTE_TRANSITIONS: Partial<
  Record<ChannelSpecRouteStatus, ChannelSpecRouteStatus[]>
> = {
  [ChannelSpecRouteStatus.VALIDATION_READY]: [
    ChannelSpecRouteStatus.VALIDATING,
    ChannelSpecRouteStatus.REJECTED,
  ],
  [ChannelSpecRouteStatus.VALIDATING]: [
    ChannelSpecRouteStatus.CONFIRMED,
    ChannelSpecRouteStatus.REJECTED,
  ],
};

export async function transitionChannelRouteStatus(
  session: SessionContext,
  productId: string,
  input: Record<string, unknown>
) {
  await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);

  const routeId = requireText(input.routeId, "routeId", 120);
  const targetText = requireText(input.targetStatus, "targetStatus", 80);
  const allowedTargetStatuses = new Set<ChannelSpecRouteStatus>([
    ChannelSpecRouteStatus.VALIDATING,
    ChannelSpecRouteStatus.CONFIRMED,
    ChannelSpecRouteStatus.REJECTED,
  ]);
  const targetStatus = targetText as ChannelSpecRouteStatus;
  if (!allowedTargetStatuses.has(targetStatus)) {
    throw new UnprocessableEntityError("不支持的渠道路线目标状态");
  }
  const reason = optionalText(input.reason, 1000);

  const route = await prisma.channelSpecRoute.findFirst({
    where: {
      id: routeId,
      organizationId: session.organizationId,
      productVersion: {
        product: {
          id: productId,
          organizationId: session.organizationId,
        },
      },
      status: { not: ChannelSpecRouteStatus.SUPERSEDED },
    },
    include: {
      productVersion: {
        select: {
          id: true,
          versionTag: true,
          isConfirmed: true,
        },
      },
      channelRuleProfile: {
        select: {
          status: true,
          channelKey: true,
          label: true,
          effectiveFrom: true,
          effectiveUntil: true,
        },
      },
    },
  });
  if (!route) throw new NotFoundError("Channel route not found");

  const allowed = ROUTE_TRANSITIONS[route.status] || [];
  if (!allowed.includes(targetStatus)) {
    throw new UnprocessableEntityError(
      `渠道路线状态不能从 ${route.status} 变更为 ${targetStatus}`
    );
  }
  if (targetStatus === ChannelSpecRouteStatus.REJECTED && !reason) {
    throw new UnprocessableEntityError("否决渠道路线时必须填写原因");
  }

  if (
    targetStatus === ChannelSpecRouteStatus.VALIDATING ||
    targetStatus === ChannelSpecRouteStatus.CONFIRMED
  ) {
    if (!route.feasible) {
      throw new UnprocessableEntityError(
        "存在经济性硬阻断的路线不能进入验证或确认"
      );
    }
    if (
      route.ruleStatusSnapshot !== ChannelRuleRecordStatus.CONFIRMED ||
      route.channelRuleProfile.status !== ChannelRuleRecordStatus.CONFIRMED
    ) {
      throw new UnprocessableEntityError(
        "渠道规则未确认或已被替代，必须先按当前确认规则重算路线"
      );
    }
    if (!isChannelRuleEffectiveAt(route.channelRuleProfile)) {
      throw new UnprocessableEntityError(
        "渠道规则不在当前生效窗口，不能进入验证或确认"
      );
    }
  }

  let marketValidationVerified = false;
  if (targetStatus === ChannelSpecRouteStatus.CONFIRMED) {
    if (!route.productVersion.isConfirmed) {
      throw new UnprocessableEntityError(
        `确认渠道路线前，产品版本 ${route.productVersion.versionTag} 必须先完成业务确认`
      );
    }

    const evidenceRows = await prisma.evidence.findMany({
      where: {
        project: {
          productId,
          organizationId: session.organizationId,
        },
      },
      select: {
        nature: true,
        verifyStatus: true,
        validationStatus: true,
        channel: true,
      },
    });
    marketValidationVerified = deriveMarketValidationVerified({
      evidence: evidenceRows,
      routeChannel: {
        channelKey: route.channelRuleProfile.channelKey,
        label: route.channelRuleProfile.label,
      },
    });
    if (!marketValidationVerified) {
      throw new UnprocessableEntityError(
        "确认渠道路线前，必须存在与该渠道匹配且由负责人确认的真实市场验证 Evidence"
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.channelSpecRoute.update({
      where: { id: route.id },
      data: { status: targetStatus },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "CHANNEL_SPEC_ROUTE_STATUS_CHANGED",
      objectType: "ChannelSpecRoute",
      objectId: route.id,
      summary: `渠道路线 ${route.name}：${route.status} → ${targetStatus}`,
      details: {
        productId,
        routeKey: route.routeKey,
        revision: route.revision,
        fromStatus: route.status,
        toStatus: targetStatus,
        reason,
        marketValidationVerified,
      } as Prisma.InputJsonValue,
    });

    return updated;
  });
}
