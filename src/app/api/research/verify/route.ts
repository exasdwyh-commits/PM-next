import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { verifyEvidence, describeVerifier } from "@/modules/evidence/verifier";
import { AppError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";

/**
 * Arena 的独立校验器把 `SourceCapture` 的 url / finalUrl / content / sourceOrganization
 * 声明为**必填**；而 `EvidenceSourceCapture` 这四列在库里是可空的（P0-B 为
 * 「先入库、后回填」放宽了它们）。
 *
 * 因此在校验器之前先做落库完整性检查：**缺项就明确报错，不填空字符串**——
 * 填 "" 会让校验器把「内容为空」当成「已抓取但未支持该断言」，把数据缺失
 * 伪装成 NOT_FOUND 结论，正好是 P0-B 要防的那种假结论。
 */
function requireCaptureFields(capture: {
  id: string;
  url: string | null;
  finalUrl: string | null;
  content: string | null;
  sourceOrganization: string | null;
}): { url: string; finalUrl: string; content: string; sourceOrganization: string } {
  const { id, url, finalUrl, content, sourceOrganization } = capture;
  if (url && finalUrl && content && sourceOrganization) {
    return { url, finalUrl, content, sourceOrganization };
  }
  const missing = [
    url ? null : "url",
    finalUrl ? null : "finalUrl",
    content ? null : "content",
    sourceOrganization ? null : "sourceOrganization",
  ].filter((field) => field !== null);
  throw new UnprocessableEntityError(
    `SourceCapture ${id} 未完整落库，缺少独立校验所需字段：${missing.join("、")}`,
    { sourceId: ["该抓取记录缺少独立校验所需字段，无法得出校验结论"] }
  );
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { claim, sourceId, verifierIdentity = "verifier_rules" } = body;

    if (!claim || !sourceId)
      throw new AppError("缺少 claim 或 sourceId", "MISSING_REQUIRED_FIELDS", 400, { claim: ["claim 与 sourceId 均为必填"] });

    const source = await prisma.evidenceSourceCapture.findFirst({
      where: { id: sourceId, organizationId: session.organizationId },
    });

    if (!source) throw new NotFoundError("SourceCapture not found");

    const otherSources = await prisma.evidenceSourceCapture.findMany({
      where: { organizationId: session.organizationId, id: { not: sourceId } },
      take: 10,
    });

    const capture = requireCaptureFields(source);

    const result = await verifyEvidence(
      {
        id: claim.id || `claim_${Date.now()}`,
        field: claim.field || "unknown",
        value: claim.value || "",
        sourceId: source.id,
        sourceUrl: capture.finalUrl,
        claimKind: claim.claimKind || "FACT",
        createdByAgent: claim.createdByAgent,
      },
      {
        id: source.id,
        url: capture.url,
        finalUrl: capture.finalUrl,
        content: capture.content,
        contentHash: source.contentHash,
        trustTier: source.trustTier as any,
        sourceOrganization: capture.sourceOrganization,
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

export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    return NextResponse.json(describeVerifier());
  } catch (e) {
    return handleApiError(e, req);
  }
}
