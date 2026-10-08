import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { verifyEvidence, describeVerifier } from "@/modules/evidence/verifier";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { claim, sourceId, verifierIdentity = "verifier_rules" } = body;

    if (!claim || !sourceId) throw new UnprocessableEntityError("缺少 claim 或 sourceId");

    const source = await prisma.evidenceSourceCapture.findFirst({
      where: { id: sourceId, organizationId: session.organizationId },
    });

    if (!source) throw new NotFoundError("SourceCapture not found");
    // 抓取记录里这四项是可空列，但 verifier 需要确定值才能判support；
    // 空值说明抓取未完成，此时必须拒绝，不能用空串/假值凑出一次"已验证"
    if (!source.id || !source.url || !source.finalUrl || !source.contentHash) {
      throw new UnprocessableEntityError("SourceCapture 抓取不完整（缺 url/finalUrl/contentHash），无法验证");
    }

    const sourceCaptureId: string = source.id;

    const otherSources = await prisma.evidenceSourceCapture.findMany({
      where: { organizationId: session.organizationId, id: { not: sourceId } },
      take: 10,
    });

    const result = await verifyEvidence(
      {
        id: claim.id || `claim_${Date.now()}`,
        field: claim.field || "unknown",
        value: claim.value || "",
        sourceId: sourceCaptureId,
        sourceUrl: source.finalUrl ?? source.url ?? undefined,
        claimKind: claim.claimKind || "FACT",
        createdByAgent: claim.createdByAgent,
      },
      {
        id: sourceCaptureId,
        url: source.url,
        finalUrl: source.finalUrl,
        content: source.content ?? "",
        contentHash: source.contentHash,
        trustTier: source.trustTier as any,
        sourceOrganization: source.sourceOrganization ?? "",
        fetchedAt: source.fetchedAt,
        injectionStatus: source.injectionStatus as any,
      },
      verifierIdentity,
      otherSources.map((s: any) => ({
        id: s.id,
        url: s.url,
        finalUrl: s.finalUrl,
        content: s.content,
        contentHash: s.contentHash,
        trustTier: s.trustTier,
        sourceOrganization: s.sourceOrganization,
        fetchedAt: s.fetchedAt,
        injectionStatus: s.injectionStatus,
      }))
    );

    // 保存验证结果
    const verification = await prisma.evidenceVerification.create({
      data: {
        organizationId: session.organizationId,
        claimId: result.claimId,
        evidenceClaimId: null,
        sourceCaptureId,
        supportStatus: result.supportStatus,
        evidenceLevel: result.evidenceLevel,
        supportSpan: result.supportSpan as any,
        sourceUri: result.sourceUri,
        sourceOrganization: result.sourceOrganization,
        verifierIdentity: result.verifierIdentity,
        metadata: result.metadata as any,
      },
    });

    return NextResponse.json({ verification, result });
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function GET() {
  return NextResponse.json(describeVerifier());
}
