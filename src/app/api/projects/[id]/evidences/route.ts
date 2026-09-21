import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import prisma from "@/shared/db";
import { EvidenceNature, EvidenceVerifyStatus, Role } from "@prisma/client";
import { UnprocessableEntityError } from "@/shared/errors";
import crypto from "crypto";
import { normalizeEvidenceClaim, EvidenceClaimInput, toClaimDbData } from "@/modules/research/evidence-claims";
import { labelEvidenceNature } from "@/shared/status-labels";
import { EVIDENCE_PUBLIC_SELECT } from "@/modules/evidence/evidence-view";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;

    // R03: Project role check: only OWNER, DECISION_MAKER, FEEDBACK_PROVIDER can submit evidence
    // VIEWER is strictly forbidden (403)
    await requireProjectRole(session, projectId, [
      Role.OWNER,
      Role.DECISION_MAKER,
      Role.FEEDBACK_PROVIDER,
    ]);

    const body = await req.json();

    if (!body.contentOrUri || !body.source) {
      throw new UnprocessableEntityError("Evidence content/URI and source are required");
    }

    // R03: Server-enforced hash calculation; client cannot forge hash
    const canonicalContent = typeof body.contentOrUri === "string" ? body.contentOrUri.trim() : JSON.stringify(body.contentOrUri);
    const serverComputedHash = crypto.createHash("sha256").update(canonicalContent).digest("hex");

    // P1-01: 客户端可随资料录入提交证据细分断言（FACT/INFERENCE/ASSUMPTION），
    // 服务端逐条校验规范化；非法断言直接拒绝，防止无规格/无机制的价格混算入库。
    const claims: EvidenceClaimInput[] = Array.isArray(body.claims) ? body.claims : [];
    const normalizedClaims = claims.map((c, i) => normalizeEvidenceClaim(c, i));

    // P1-01: 记录独立采集时点（区别于「录入时刻」）与资料日期，便于来源追溯
    const parseExtDate = (raw: unknown, label: string): Date | null => {
      if (raw === undefined || raw === null || raw === "") return null;
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw new UnprocessableEntityError(`非法${label}格式，应为 ISO 日期时间`);
      return d;
    };
    const obtainedAt = parseExtDate(body.obtainedAt, "采集时间");
    const infoDate = parseExtDate(body.infoDate, "资料日期");

    // R03: Initial status is ALWAYS UNVERIFIED on creation; client cannot pass VERIFIED
    const evidence = await prisma.$transaction(async (tx) => {
      const created = await tx.evidence.create({
        data: {
          projectId,
          contentOrUri: canonicalContent,
          source: body.source.trim(),
          author: body.author ? body.author.trim() : session.userName,
          hash: serverComputedHash,
          nature: body.nature === "DEMO" ? EvidenceNature.DEMO : EvidenceNature.REAL,
          verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
          productRef: body.productRef ? String(body.productRef).trim() : null,
          channel: body.channel ? String(body.channel).trim() : null,
          obtainedAt: obtainedAt ?? undefined,
          infoDate: infoDate ?? undefined,
          claims: normalizedClaims.length > 0
            ? { create: normalizedClaims.map((c) => toClaimDbData(c!)) }
            : undefined,
        },
        // B6：只回传白名单字段（此前返回整行，含服务端存储键 fileKey）
        select: EVIDENCE_PUBLIC_SELECT,
      });

      await tx.auditEvent.create({
        data: {
          actorId: session.userId,
          action: "EVIDENCE_CREATED",
          objectType: "Evidence",
          objectId: created.id,
          summary: `录入新证据资料 (性质: ${labelEvidenceNature(created.nature)}，断言 ${normalizedClaims.length} 条)，服务端哈希: ${serverComputedHash.slice(0, 16)}`,
        },
      });

      return created;
    });

    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
