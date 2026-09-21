import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import prisma from "@/shared/db";
import { Role, ValidationStatus } from "@prisma/client";
import { buildEvidenceInsight } from "@/modules/research/evidence-claims";
import { parseProjectRequirements } from "@/modules/research/requirement-parser";
import { synthesizeOpportunityAnalysis } from "@/modules/research/opportunity-analysis";
import { BUSINESS_BASELINE, BASELINE_FIELD } from "@/config/business-baseline";
import { UnprocessableEntityError } from "@/shared/errors";
import { labelValidationStatus } from "@/shared/status-labels";

/**
 * P1-02: 机会分析与市场验证
 *
 * GET: 基于已核实 VERIFIED 证据返回机会类型+判断依据、八要素三态分列、市场验证列表、
 *      以及按业务基线计算的阻断关键缺口（不新增不可靠市场数字）。
 * PATCH: 仅 OWNER 可录入市场验证（样本/局限/时间范围）并置验证状态（UNAPPLIED→IN_PROGRESS→VERIFIED_BY_LEAD）。
 *      验证状态只能由负责人手动确认，任何模型/纯函数不得写入——不以模型评分替代真实验证。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;

    await requireProjectRole(session, projectId, [
      Role.OWNER,
      Role.DECISION_MAKER,
      Role.VIEWER,
    ]);

    const [evidences, project] = await Promise.all([
      prisma.evidence.findMany({
        where: { projectId },
        include: { claims: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { target: true, constraints: true },
      }),
    ]);

    const constraints = parseProjectRequirements(
      `${project?.target ?? ""} ${project?.constraints ?? ""}`
    ).constraints;

    const { resolved, gaps } = buildEvidenceInsight(evidences);
    const opportunity = synthesizeOpportunityAnalysis({ resolved, gaps }, constraints);

    // 按业务基线计算阻断关键缺口（与 commitProductSuggestionToGate 同一口径）
    const blockingKeyGaps: string[] = [];
    const hasPriceGap = gaps.some((g) => g.fieldKey === BASELINE_FIELD.price);
    if (BUSINESS_BASELINE.priceRequired && hasPriceGap) {
      blockingKeyGaps.push(BASELINE_FIELD.price);
    }
    if (
      BUSINESS_BASELINE.followHitRequiresSalesVolume &&
      opportunity.type === "FOLLOW_HIT_PRODUCT" &&
      gaps.some((g) => g.fieldKey === BASELINE_FIELD.salesVolume)
    ) {
      blockingKeyGaps.push(BASELINE_FIELD.salesVolume);
    }

    // 市场验证列表：已核实证据中带有验证字段或验证类断言的记录，状态仅反映负责人手动确认
    const validations = evidences
      .filter(
        (e) =>
          e.verifyStatus === "VERIFIED" &&
          (e.validationSampleSize ||
            e.validationTimeRange ||
            e.validationLimitations ||
            e.validationStatus !== "UNAPPLIED" ||
            e.claims?.some((c) => c.fieldKey?.startsWith("validation.")))
      )
      .map((e) => ({
        evidenceId: e.id,
        sampleSize: e.validationSampleSize,
        timeRange: e.validationTimeRange,
        limitations: e.validationLimitations,
        status: e.validationStatus,
        claims:
          (e.claims
            ?.filter((c) => c.fieldKey?.startsWith("validation."))
            .map((c) => ({ key: c.fieldKey, value: c.value, kind: c.kind, source: e.source })) ?? []),
      }));

    return NextResponse.json({
      type: opportunity.type,
      basis: opportunity.basis,
      elements: opportunity.elements,
      blockingKeyGaps,
      followingHitRequiresSalesVolume:
        BUSINESS_BASELINE.followHitRequiresSalesVolume &&
        opportunity.type === "FOLLOW_HIT_PRODUCT",
      validations,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;

    // 验证录入 + 置状态仅限项目负责人手动执行
    await requireProjectRole(session, projectId, [Role.OWNER]);

    const body = await req.json();
    if (!body.evidenceId) {
      throw new UnprocessableEntityError("evidenceId is required");
    }

    const evidence = await prisma.evidence.findFirst({
      where: { id: body.evidenceId, projectId },
    });
    if (!evidence) {
      throw new UnprocessableEntityError("Evidence not found in this project");
    }

    const validation = body.validation ?? {};
    const nextStatus = body.status as ValidationStatus | undefined;
    const VALID_STATUSES = new Set<string>([
      ValidationStatus.UNAPPLIED,
      ValidationStatus.IN_PROGRESS,
      ValidationStatus.VERIFIED_BY_LEAD,
    ]);
    if (nextStatus !== undefined && !VALID_STATUSES.has(nextStatus)) {
      throw new UnprocessableEntityError(`非法验证状态：${nextStatus}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          validationSampleSize:
            validation.sampleSize !== undefined ? String(validation.sampleSize) : undefined,
          validationTimeRange:
            validation.timeRange !== undefined ? String(validation.timeRange) : undefined,
          validationLimitations:
            validation.limitations !== undefined ? String(validation.limitations) : undefined,
          validationStatus: nextStatus ?? undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "MARKET_VALIDATION_UPDATED",
          objectType: "Evidence",
          objectId: result.id,
          summary: `负责人更新市场验证：样本=${result.validationSampleSize ?? "-"}，时间范围=${result.validationTimeRange ?? "-"}，局限=${result.validationLimitations ?? "-"}，状态=${labelValidationStatus(result.validationStatus)}（仅负责人手动确认，不以模型评分替代）`,
        },
      });

      return result;
    });

    return NextResponse.json({
      evidenceId: updated.id,
      validationStatus: updated.validationStatus,
      validationSampleSize: updated.validationSampleSize,
      validationTimeRange: updated.validationTimeRange,
      validationLimitations: updated.validationLimitations,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}