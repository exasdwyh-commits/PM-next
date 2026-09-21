import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import prisma from "@/shared/db";
import { EvidenceVerifyStatus, Role } from "@prisma/client";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import { labelEvidenceVerifyStatus } from "@/shared/status-labels";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: evidenceId } = await params;

    const evidence = await prisma.evidence.findUnique({
      where: { id: evidenceId },
      include: { project: true },
    });

    if (!evidence || evidence.project.organizationId !== session.organizationId) {
      throw new NotFoundError("Evidence not found");
    }

    // R03: Only Project OWNER can formally verify evidence for gate decisions
    await requireProjectRole(session, evidence.projectId, [Role.OWNER]);

    const body = await readJsonObjectBody(req);
    const newStatus = body.status === "REJECTED" ? EvidenceVerifyStatus.REJECTED : EvidenceVerifyStatus.VERIFIED;

    const updated = await prisma.$transaction(async (tx) => {
      const e = await tx.evidence.update({
        where: { id: evidenceId },
        data: {
          verifyStatus: newStatus,
          verifiedByUserId: session.userId,
          verifiedAt: new Date(),
        },
      });

      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: `EVIDENCE_${newStatus}`,
        objectType: "Evidence",
        objectId: e.id,
        summary: `项目负责人独立核实证据：状态变更为 ${labelEvidenceVerifyStatus(newStatus)}`,
      });

      return e;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, req);
  }
}
