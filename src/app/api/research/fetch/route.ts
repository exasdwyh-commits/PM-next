import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { fetchSource, describeSourceFetcher } from "@/modules/research/source-fetch";
import { checkAndCharge } from "@/modules/model-gateway/cost-guard";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { url, missionId, nodeKey } = body;

    if (!url) throw new UnprocessableEntityError("缺少 url");

    // Cost guard - research_call
    const guard = await checkAndCharge({
      organizationId: session.organizationId,
      missionId,
      taskClass: "research_fetch",
      estimatedTokens: 500,
      modelProfileKey: "source-fetcher",
    });

    if (!guard.allowed) {
      return NextResponse.json({ error: guard.reason, guard }, { status: 429 });
    }

    const result = await fetchSource({
      url,
      organizationId: session.organizationId,
      missionId,
      nodeKey,
    });

    // 保存 SourceCapture (EvidenceSourceCapture)
    const capture = await prisma.evidenceSourceCapture.create({
      data: {
        organizationId: session.organizationId,
        url: result.url,
        finalUrl: result.finalUrl,
        sourceUri: result.finalUrl,
        content: result.content.slice(0, 10000),
        rawContentPreview: result.content.slice(0, 2000),
        contentHash: result.contentHash,
        trustTier: result.trustTier,
        sourceOrganization: result.sourceOrganization,
        fetchedAt: result.fetchedAt,
        injectionStatus: result.injectionStatus,
        ip: result.ip,
        sizeBytes: result.sizeBytes,
        mimeType: result.contentType,
        contentType: result.contentType,
        sourceType: "WEB",
        httpStatus: result.statusCode,
        fetcherIdentity: "source-fetcher",
        remoteAddress: result.ip,
      },
    });

    return NextResponse.json({ capture, fetch: result, guard });
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    // 只读能力描述，但仍须登录：与同文件 POST 口径一致
    await getServerSession(req);
    return NextResponse.json(describeSourceFetcher());
  } catch (e) {
    return handleApiError(e, req);
  }
}
