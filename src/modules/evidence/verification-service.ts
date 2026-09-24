import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { NotFoundError, ForbiddenError } from "@/shared/errors";
import {
  IndependentEvidenceVerifier,
  type VerifierSource,
} from "./verifier";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function verifyEvidenceClaim(
  session: SessionContext,
  input: {
    evidenceClaimId: string;
    sources: VerifierSource[];
  }
) {
  const claim = await prisma.evidenceClaim.findUnique({
    where: { id: input.evidenceClaimId },
    include: {
      evidence: {
        include: {
          project: { select: { organizationId: true } },
        },
      },
    },
  });
  if (!claim) throw new NotFoundError("Evidence claim not found");
  if (claim.evidence.project.organizationId !== session.organizationId) {
    throw new NotFoundError("Evidence claim not found");
  }

  const evidenceIds = [...new Set(input.sources.map((source) => source.evidenceId))];
  if (evidenceIds.length) {
    const rows = await prisma.evidence.findMany({
      where: { id: { in: evidenceIds } },
      select: { id: true, project: { select: { organizationId: true } } },
    });
    if (
      rows.length !== evidenceIds.length ||
      rows.some((row) => row.project.organizationId !== session.organizationId)
    ) {
      throw new ForbiddenError("Cross-organization evidence verification forbidden");
    }
  }

  const verifier = new IndependentEvidenceVerifier("independent-verifier/v1");
  const result = verifier.verifyClaim(
    { claim: claim.value, claimKind: claim.kind },
    input.sources
  );
  const verifierRunId = `VERIFY-${crypto.randomUUID()}`;

  return prisma.$transaction(async (tx) => {
    for (const assessment of result.assessments) {
      await tx.evidenceVerification.create({
        data: {
          evidenceClaimId: claim.id,
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
    };
  });
}
