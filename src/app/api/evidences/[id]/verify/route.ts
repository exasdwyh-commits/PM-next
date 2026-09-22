import { NextRequest, NextResponse } from "next/server";
import { getServerSession, requireProjectRole } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import prisma from "@/shared/db";
import { EvidenceVerifyStatus, Role } from "@prisma/client";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import { labelEvidenceVerifyStatus } from "@/shared/status-labels";
import {
  BUSINESS_EVENT_TYPES,
  dispatchBusinessEvent,
  enqueueBusinessEventInTx,
} from "@/modules/business-events";

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

    const result = await prisma.$transaction(async (tx) => {
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

      let eventId: string | null = null;
      if (newStatus === EvidenceVerifyStatus.VERIFIED) {
        const event = await enqueueBusinessEventInTx(tx, {
          organizationId: session.organizationId,
          eventKey: `evidence:${e.id}:verified`,
          eventType: BUSINESS_EVENT_TYPES.EVIDENCE_VERIFIED,
          aggregateType: "Evidence",
          aggregateId: e.id,
          payload: {
            projectId: e.projectId,
            verifyStatus: e.verifyStatus,
            nature: e.nature,
            validationStatus: e.validationStatus,
          },
          contextRefs: [
            `project:${e.projectId}`,
            `evidence:${e.id}`,
          ],
          createdById: session.userId,
        });
        eventId = event.id;
      }

      return { evidence: e, eventId };
    });

    if (result.eventId) {
      await dispatchBusinessEvent(session.organizationId, result.eventId, {
        workerId: "evidence-verify:" + session.userId,
      }).catch(() => null);
    }

    return NextResponse.json(result.evidence);
  } catch (error) {
    return handleApiError(error, req);
  }
}
