import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { NotFoundError, ForbiddenError } from "@/shared/errors";
import { IndependentEvidenceVerifier } from "./verifier";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function verifyEvidenceClaim(
  session: SessionContext,
  input: {
    evidenceClaimId: string;
    sourceCaptureIds: string[];
  }
) {
  const claim = await prisma.evidenceClaim.findUnique({
    where: { id: input.evidenceClaimId },
    include: {
      evidence: {
        include: {
          project: { select: { organizationId: true, id: true } },
        },
      },
    },
  });
  if (!claim) throw new NotFoundError("Evidence claim not found");
  if (claim.evidence.project.organizationId !== session.organizationId) {
    throw new NotFoundError("Evidence claim not found");
  }

  const captureIds = [...new Set(input.sourceCaptureIds.filter(Boolean))];
  if (!captureIds.length) {
    throw new ForbiddenError("Independent verification requires durable source captures");
  }

  const captures = await prisma.evidenceSourceCapture.findMany({
    where: { id: { in: captureIds } },
    include: {
      evidence: {
        include: {
          project: { select: { id: true, organizationId: true } },
        },
      },
    },
  });

  if (captures.length !== captureIds.length) {
    throw new NotFoundError("One or more source captures were not found");
  }
  if (
    captures.some(
      (capture) =>
        capture.evidence.project.organizationId !== session.organizationId ||
        capture.evidence.project.id !== claim.evidence.project.id
    )
  ) {
    throw new ForbiddenError(
      "Cross-project or cross-organization source capture verification forbidden"
    );
  }

  const verifier = new IndependentEvidenceVerifier("independent-verifier/v1");
  const result = verifier.verifyClaim(
    { claim: claim.value, claimKind: claim.kind },
    captures.map((capture) => ({
      evidenceId: capture.evidenceId,
      sourceCaptureId: capture.id,
      sourceUri: capture.sourceUri,
      httpStatus: capture.httpStatus,
      rawContentPreview: capture.rawContentPreview,
      quarantined: capture.injectionStatus === "QUARANTINED",
    }))
  );
  const verifierRunId = `VERIFY-${crypto.randomUUID()}`;

  return prisma.$transaction(async (tx) => {
    for (const assessment of result.assessments) {
      await tx.evidenceVerification.create({
        data: {
          evidenceClaimId: claim.id,
          sourceCaptureId: assessment.sourceCaptureId,
          verifierIdentity: result.verifierIdentity,
          supportStatus: assessment.supportStatus,
          supportSpan: assessment.supportSpan,
          sourceUri: assessment.sourceUri,
          sourceOrganization: assessment.sourceOrganization,
          metadata: json({
            evidenceId: assessment.evidenceId,
            trustTier: assessment.trustTier,
            verifierRunId,
          }),
        },
      });
    }

    const updated = await tx.evidenceClaim.update({
      where: { id: claim.id },
      data: {
        evidenceLevel: result.evidenceLevel,
        verifierRunId,
      },
    });

    return {
      verifierRunId,
      claim: updated,
      verification: result,
      sourceCaptureIds: captureIds,
    };
  });
}
