import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { verifyEvidence, describeVerifier } from "@/modules/evidence/verifier";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { claim, sourceId, verifierIdentity = "verifier_rules" } = body;

    if (!claim || !sourceId) throw new Error("缺少 claim 或 sourceId");

    const source = await prisma.evidenceSourceCapture.findFirst({
      where: { id: sourceId, organizationId: session.organizationId },
    });

    if (!source) throw new Error("SourceCapture not found");

    const otherSources = await prisma.evidenceSourceCapture.findMany({
      where: { organizationId: session.organizationId, id: { not: sourceId } },
      take: 10,
    });

    const result = await verifyEvidence(
      {
        id: claim.id || `claim_${Date.now()}`,
        field: claim.field || "unknown",
        value: claim.value || "",
        sourceId: source.id,
        sourceUrl: source.finalUrl,
        claimKind: claim.claimKind || "FACT",
        createdByAgent: claim.createdByAgent,
      },
      {
        id: source.id,
        url: source.url,
        finalUrl: source.finalUrl,
        content: source.content,
        contentHash: source.contentHash,
        trustTier: source.trustTier as any,
        sourceOrganization: source.sourceOrganization,
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
        sourceCaptureId: source.id,
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
