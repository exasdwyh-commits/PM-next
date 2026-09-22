import crypto from "node:crypto";
import {
  BacktestAlignmentStatus,
  ExperienceLessonStatus,
  FrozenPredictionVerdict,
  Prisma,
  ProductValidationOutcomeStatus,
} from "@prisma/client";
import prisma from "@/shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import type { SessionContext } from "@/modules/identity/session";
import {
  PRODUCT_WRITE_ROLES,
  requireProductRole,
} from "@/modules/identity/product-access";
import { isOrgAdmin } from "@/modules/identity/admin";
import {
  PRODUCT_POTENTIAL_RULE_VERSION,
  assessProductPotential,
  type PotentialDimensionInput,
  type PotentialDimensionKey,
  type PotentialGateInput,
  type PotentialVerdict,
} from "@/modules/product-development/potential-assessment";
import {
  buildDimensionReliabilityLesson,
  evaluatePredictionAgainstOutcome,
  type DimensionReliabilityObservation,
  type FrozenPotentialPrediction,
} from "./calibration";
import type {
  FrozenDecisionIdentity,
  VerifiedProductOutcome,
} from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function hashCanonical(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stringArrayFromJson(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function assertRatio(name: string, value: number | null | undefined) {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new UnprocessableEntityError(`${name} 必须在 0-1 之间`);
  }
}

function assertObservationKey(value: string): string {
  const key = value?.trim();
  if (!key || !/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
    throw new UnprocessableEntityError(
      "observationKey 必须为 1-64 位字母、数字、点、下划线或短横线"
    );
  }
  return key;
}

function predictionIdentity(row: {
  organizationId: string;
  productId: string;
  productVersionId: string;
  productVersionFingerprint: string;
  channelRouteId: string | null;
  channelRouteFingerprint: string | null;
  assessmentRuleVersion: string;
  evaluatedAt: Date;
}): FrozenDecisionIdentity {
  return {
    organizationId: row.organizationId,
    productId: row.productId,
    productVersionId: row.productVersionId,
    productVersionFingerprint: row.productVersionFingerprint,
    channelRouteId: row.channelRouteId,
    channelRouteFingerprint: row.channelRouteFingerprint,
    assessmentRuleVersion: row.assessmentRuleVersion,
    evaluatedAt: row.evaluatedAt.toISOString(),
  };
}

function mapBacktestAlignment(
  alignment:
    | "ALIGNED_SUCCESS"
    | "ALIGNED_FAILURE"
    | "FALSE_POSITIVE"
    | "FALSE_NEGATIVE"
    | "ABSTAINED"
    | "INCONCLUSIVE"
    | "IDENTITY_MISMATCH"
    | "UNVERIFIED_OUTCOME"
): BacktestAlignmentStatus {
  switch (alignment) {
    case "ALIGNED_SUCCESS":
      return BacktestAlignmentStatus.ALIGNED_SUCCESS;
    case "ALIGNED_FAILURE":
      return BacktestAlignmentStatus.ALIGNED_FAILURE;
    case "FALSE_POSITIVE":
      return BacktestAlignmentStatus.FALSE_POSITIVE;
    case "FALSE_NEGATIVE":
      return BacktestAlignmentStatus.FALSE_NEGATIVE;
    case "ABSTAINED":
      return BacktestAlignmentStatus.ABSTAINED;
    case "INCONCLUSIVE":
      return BacktestAlignmentStatus.INCONCLUSIVE;
    case "IDENTITY_MISMATCH":
    case "UNVERIFIED_OUTCOME":
      throw new Error(
        `verified outcome persistence invariant broken: ${alignment}`
      );
  }
}

export interface FreezePotentialPredictionInput {
  productId: string;
  productVersionId: string;
  dimensions: PotentialDimensionInput[];
  gates: PotentialGateInput[];
  marketValidationVerified: boolean;
  assessmentRuleVersion?: string;
  segmentKey?: string;
  channelRouteId?: string | null;
  channelRouteSnapshot?: unknown | null;
  evidenceFingerprint?: string | null;
  modelPolicyKey?: string | null;
  modelProfileId?: string | null;
  promptVersion?: string | null;
}

export async function freezePotentialPrediction(
  session: SessionContext,
  input: FreezePotentialPredictionInput
) {
  const segmentKey = input.segmentKey?.trim() || "global";
  const ruleVersion =
    input.assessmentRuleVersion?.trim() || PRODUCT_POTENTIAL_RULE_VERSION;

  await requireProductRole(session, input.productId, PRODUCT_WRITE_ROLES);

  const version = await prisma.productVersion.findUnique({
    where: { id: input.productVersionId },
    select: {
      id: true,
      productId: true,
      versionTag: true,
      specs: true,
      technicalAdvice: true,
      experienceGoals: true,
      targetCost: true,
      currency: true,
      unknowns: true,
      evidenceRefs: true,
      isImmutable: true,
      isConfirmed: true,
      createdAt: true,
    },
  });

  if (!version || version.productId !== input.productId) {
    throw new NotFoundError("Product version not found");
  }

  const productVersionFingerprint = hashCanonical({
    id: version.id,
    productId: version.productId,
    versionTag: version.versionTag,
    specs: version.specs,
    technicalAdvice: version.technicalAdvice,
    experienceGoals: version.experienceGoals,
    targetCost:
      version.targetCost == null ? null : version.targetCost.toString(),
    currency: version.currency,
    unknowns: version.unknowns,
    evidenceRefs: version.evidenceRefs,
    isImmutable: version.isImmutable,
    isConfirmed: version.isConfirmed,
    createdAt: version.createdAt.toISOString(),
  });

  const channelRouteFingerprint =
    input.channelRouteSnapshot == null
      ? null
      : hashCanonical(input.channelRouteSnapshot);

  // 结论必须由服务器依据同一版本规则重新计算，禁止调用方携带现成 assessment
  // 写入经验库；否则前端/Agent 可把任意 verdict 伪装成“当时系统判断”。
  const assessment = assessProductPotential({
    dimensions: input.dimensions,
    gates: input.gates,
    marketValidationVerified: input.marketValidationVerified,
  });

  return prisma.$transaction(async (tx) => {
    const prediction = await tx.frozenPrediction.create({
      data: {
        organizationId: session.organizationId,
        productId: input.productId,
        productVersionId: input.productVersionId,
        productVersionFingerprint,
        channelRouteId: input.channelRouteId ?? null,
        channelRouteFingerprint,
        segmentKey,
        assessmentRuleVersion: ruleVersion,
        verdict: assessment.verdict as FrozenPredictionVerdict,
        diagnosticIndex: assessment.diagnosticIndex,
        coverageRatio: assessment.coverageRatio,
        verifiedCoverageRatio: assessment.verifiedCoverageRatio,
        dimensionSnapshot: toJson(input.dimensions),
        gateSnapshot: toJson(input.gates),
        evidenceFingerprint: input.evidenceFingerprint ?? null,
        modelPolicyKey: input.modelPolicyKey ?? null,
        modelProfileId: input.modelProfileId ?? null,
        promptVersion: input.promptVersion ?? null,
        createdById: session.userId,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "POTENTIAL_PREDICTION_FROZEN",
      objectType: "FrozenPrediction",
      objectId: prediction.id,
      summary: `冻结产品潜力判断：${prediction.verdict}`,
      details: {
        productId: prediction.productId,
        productVersionId: prediction.productVersionId,
        productVersionFingerprint,
        channelRouteId: prediction.channelRouteId,
        channelRouteFingerprint,
        segmentKey,
        assessmentRuleVersion: ruleVersion,
        modelPolicyKey: prediction.modelPolicyKey,
        modelProfileId: prediction.modelProfileId,
      } as Prisma.InputJsonValue,
    });

    return prediction;
  });
}

export interface RecordVerifiedProductOutcomeInput {
  observationKey: string;
  outcome: ProductValidationOutcomeStatus;
  evidenceRefs: string[];
  channelAccepted?: boolean | null;
  launched?: boolean | null;
  /** 百分比，例如 18.5 表示 18.5%。 */
  actualContributionMarginRate?: number | null;
  /** 0-1 比例。 */
  actualReturnRate?: number | null;
  /** 0-1 比例。 */
  repeatPurchaseRate?: number | null;
  observationDays?: number | null;
  notes?: string[];
}

export async function recordVerifiedProductOutcome(
  session: SessionContext,
  frozenPredictionId: string,
  input: RecordVerifiedProductOutcomeInput
) {
  const observationKey = assertObservationKey(input.observationKey);
  const evidenceRefs = Array.from(
    new Set(
      (input.evidenceRefs ?? [])
        .map((ref) => ref.trim())
        .filter((ref) => ref.length > 0)
    )
  );
  if (evidenceRefs.length === 0) {
    throw new UnprocessableEntityError(
      "ProductOutcome 必须至少引用一条已核实真实证据"
    );
  }
  assertRatio("actualReturnRate", input.actualReturnRate);
  assertRatio("repeatPurchaseRate", input.repeatPurchaseRate);
  if (
    input.actualContributionMarginRate != null &&
    !Number.isFinite(input.actualContributionMarginRate)
  ) {
    throw new UnprocessableEntityError(
      "actualContributionMarginRate 必须是有限数字"
    );
  }
  if (
    input.observationDays != null &&
    (!Number.isInteger(input.observationDays) || input.observationDays < 0)
  ) {
    throw new UnprocessableEntityError(
      "observationDays 必须是非负整数"
    );
  }

  const prediction = await prisma.frozenPrediction.findUnique({
    where: { id: frozenPredictionId },
  });
  if (
    !prediction ||
    prediction.organizationId !== session.organizationId
  ) {
    throw new NotFoundError("Frozen prediction not found");
  }

  await requireProductRole(session, prediction.productId, PRODUCT_WRITE_ROLES);

  const existing = await prisma.productOutcome.findUnique({
    where: {
      frozenPredictionId_observationKey: {
        frozenPredictionId,
        observationKey,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      "该预测的该观察窗口已经有已核实 Outcome；历史结果不可覆盖"
    );
  }

  const identity = predictionIdentity(prediction);
  const predictionForBacktest: FrozenPotentialPrediction = {
    identity,
    verdict: prediction.verdict as PotentialVerdict,
    diagnosticIndex: prediction.diagnosticIndex,
    coverageRatio: prediction.coverageRatio,
    verifiedCoverageRatio: prediction.verifiedCoverageRatio,
    dimensions: Array.isArray(prediction.dimensionSnapshot)
      ? (prediction.dimensionSnapshot as unknown as FrozenPotentialPrediction["dimensions"])
      : [],
  };
  const outcomeForBacktest: VerifiedProductOutcome = {
    identity,
    outcome: input.outcome,
    evidenceRefs,
    verifiedByUserId: session.userId,
    verifiedAt: new Date().toISOString(),
    channelAccepted: input.channelAccepted ?? null,
    launched: input.launched ?? null,
    actualContributionMarginRate:
      input.actualContributionMarginRate ?? null,
    actualReturnRate: input.actualReturnRate ?? null,
    repeatPurchaseRate: input.repeatPurchaseRate ?? null,
    observationDays: input.observationDays ?? null,
    notes: input.notes ?? [],
  };

  const backtest = evaluatePredictionAgainstOutcome({
    prediction: predictionForBacktest,
    outcome: outcomeForBacktest,
  });
  const backtestAlignment = mapBacktestAlignment(backtest.alignment);
  const verifiedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const outcome = await tx.productOutcome.create({
      data: {
        organizationId: session.organizationId,
        frozenPredictionId,
        observationKey,
        outcome: input.outcome,
        evidenceRefs: toJson(evidenceRefs),
        verifiedById: session.userId,
        verifiedAt,
        channelAccepted: input.channelAccepted ?? null,
        launched: input.launched ?? null,
        actualContributionMarginRate:
          input.actualContributionMarginRate ?? null,
        actualReturnRate: input.actualReturnRate ?? null,
        repeatPurchaseRate: input.repeatPurchaseRate ?? null,
        observationDays: input.observationDays ?? null,
        notes: input.notes ? toJson(input.notes) : undefined,
        backtestAlignment,
        backtestComparable: backtest.comparable,
        backtestReason: backtest.reason,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCT_OUTCOME_VERIFIED",
      objectType: "ProductOutcome",
      objectId: outcome.id,
      summary: `${observationKey} 真实结果：${input.outcome} / ${backtest.alignment}`,
      details: {
        frozenPredictionId,
        observationKey,
        evidenceRefs,
        backtestAlignment: backtest.alignment,
        backtestComparable: backtest.comparable,
      } as Prisma.InputJsonValue,
    });

    return outcome;
  });
}

export interface RebuildDimensionLessonInput {
  segmentKey: string;
  observationKey: string;
  dimensionKey: PotentialDimensionKey;
  minSampleSize?: number;
  minMeanGap?: number;
}

export async function rebuildDimensionExperienceLesson(
  session: SessionContext,
  input: RebuildDimensionLessonInput
) {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError(
      "Only organization admins can rebuild organization-wide experience lessons"
    );
  }

  const segmentKey = input.segmentKey?.trim();
  if (!segmentKey) {
    throw new UnprocessableEntityError("segmentKey is required");
  }
  const observationKey = assertObservationKey(input.observationKey);

  const rows = await prisma.productOutcome.findMany({
    where: {
      organizationId: session.organizationId,
      observationKey,
      outcome: {
        in: [
          ProductValidationOutcomeStatus.SUCCESS,
          ProductValidationOutcomeStatus.FAILURE,
        ],
      },
      frozenPrediction: { segmentKey },
    },
    include: { frozenPrediction: true },
    orderBy: { createdAt: "asc" },
  });

  const observations: DimensionReliabilityObservation[] = [];
  for (const row of rows) {
    const snapshot = row.frozenPrediction.dimensionSnapshot;
    if (!Array.isArray(snapshot)) continue;
    const dim = snapshot.find(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).key === input.dimensionKey
    ) as Record<string, unknown> | undefined;
    if (!dim || typeof dim.score !== "number") continue;

    observations.push({
      segmentKey,
      dimensionKey: input.dimensionKey,
      score: dim.score,
      outcome:
        row.outcome === ProductValidationOutcomeStatus.SUCCESS
          ? "SUCCESS"
          : "FAILURE",
      evidenceRefs: stringArrayFromJson(row.evidenceRefs),
    });
  }

  const candidate = buildDimensionReliabilityLesson({
    observations,
    segmentKey,
    dimensionKey: input.dimensionKey,
    minSampleSize: input.minSampleSize,
    minMeanGap: input.minMeanGap,
  });

  const lessonKey = `${candidate.key}:${observationKey}`;
  const latest = await prisma.experienceLesson.aggregate({
    where: {
      organizationId: session.organizationId,
      key: lessonKey,
    },
    _max: { version: true },
  });
  const version = (latest._max.version ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    const lesson = await tx.experienceLesson.create({
      data: {
        organizationId: session.organizationId,
        key: lessonKey,
        version,
        segmentKey,
        targetType: "POTENTIAL_DIMENSION",
        targetKey: input.dimensionKey,
        statement: candidate.statement,
        supportCount: candidate.supportCount,
        contradictionCount: candidate.contradictionCount,
        sampleSize: candidate.sampleSize,
        evidenceRefs: toJson(candidate.evidenceRefs),
        status: ExperienceLessonStatus.CANDIDATE,
        readyForReview: candidate.readyForReview,
        limitations: toJson(candidate.limitations),
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "EXPERIENCE_LESSON_REBUILT",
      objectType: "ExperienceLesson",
      objectId: lesson.id,
      summary: `生成经验候选：${input.dimensionKey} / ${segmentKey} / ${observationKey}`,
      details: {
        sampleSize: lesson.sampleSize,
        supportCount: lesson.supportCount,
        contradictionCount: lesson.contradictionCount,
        readyForReview: lesson.readyForReview,
        version,
      } as Prisma.InputJsonValue,
    });

    return lesson;
  });
}

export async function reviewExperienceLesson(
  session: SessionContext,
  lessonId: string,
  input: { decision: "APPROVE" | "REJECT"; reason: string }
) {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError(
      "Only organization admins can review experience lessons"
    );
  }
  const reason = input.reason?.trim();
  if (!reason) {
    throw new UnprocessableEntityError("Review reason is required");
  }

  const lesson = await prisma.experienceLesson.findUnique({
    where: { id: lessonId },
  });
  if (!lesson || lesson.organizationId !== session.organizationId) {
    throw new NotFoundError("Experience lesson not found");
  }
  if (lesson.status !== ExperienceLessonStatus.CANDIDATE) {
    throw new ConflictError(
      `Experience lesson is ${lesson.status}, expected CANDIDATE`
    );
  }
  if (input.decision === "APPROVE" && !lesson.readyForReview) {
    throw new UnprocessableEntityError(
      "样本量或区分度仍不足，只能保留候选或驳回，不能批准为正式经验"
    );
  }

  const status =
    input.decision === "APPROVE"
      ? ExperienceLessonStatus.APPROVED
      : ExperienceLessonStatus.REJECTED;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.experienceLesson.update({
      where: { id: lesson.id },
      data: {
        status,
        reviewedById: session.userId,
        reviewedAt: new Date(),
        decisionReason: reason,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "EXPERIENCE_LESSON_REVIEWED",
      objectType: "ExperienceLesson",
      objectId: lesson.id,
      summary: `经验候选审核：${status}`,
      details: {
        decision: input.decision,
        reason,
        readyForReview: lesson.readyForReview,
        note:
          "批准经验只改变 ExperienceLesson 状态，不自动修改权重、渠道规则或 ModelPolicy",
      } as Prisma.InputJsonValue,
    });

    return updated;
  });
}

export async function getExperienceOverview(session: SessionContext) {
  const [predictionCount, outcomeGroups, lessonGroups, recentLessons] =
    await Promise.all([
      prisma.frozenPrediction.count({
        where: { organizationId: session.organizationId },
      }),
      prisma.productOutcome.groupBy({
        by: ["backtestAlignment"],
        where: { organizationId: session.organizationId },
        _count: { _all: true },
      }),
      prisma.experienceLesson.groupBy({
        by: ["status"],
        where: { organizationId: session.organizationId },
        _count: { _all: true },
      }),
      prisma.experienceLesson.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  return {
    predictionCount,
    backtests: Object.fromEntries(
      outcomeGroups.map((row) => [
        row.backtestAlignment,
        row._count._all,
      ])
    ),
    lessons: Object.fromEntries(
      lessonGroups.map((row) => [row.status, row._count._all])
    ),
    recentLessons,
  };
}
