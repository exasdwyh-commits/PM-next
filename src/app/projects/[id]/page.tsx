import prisma from "@/shared/db";
import { notFound, redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { buildEvidenceInsight } from "@/modules/research/evidence-claims";
import { parseProjectRequirements } from "@/modules/research/requirement-parser";
import { synthesizeOpportunityAnalysis } from "@/modules/research/opportunity-analysis";
import { BUSINESS_BASELINE, BASELINE_FIELD } from "@/config/business-baseline";
import { getRuntimeStatus, isMockAuthEnabled } from "@/shared/runtime-status";
import { toSessionView } from "@/shared/session-view";
import { getProjectDetail } from "@/modules/projects/service";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import ProjectDetailClient from "./project-detail-client";
import { RoleProvider } from "@/components/role-context";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headerList = await headers();
  const cookieStore = await cookies();

  let session: any = null;
  try {
    session = await getServerSessionFromContext(headerList, cookieStore);
  } catch (e) {
    redirect("/login");
  }

  let project;
  try {
    project = await getProjectDetail(session, id);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) notFound();
    throw error;
  }

  const mockAuth = isMockAuthEnabled();
  const allUsers = mockAuth
    ? await prisma.user.findMany({
        where: { organizationId: session.organizationId, isActive: true },
        select: { id: true, name: true, email: true },
      })
    : [];

  const gaps = project.gaps;
  const evidenceInsight = buildEvidenceInsight(project.evidences);
  const { resolved, gaps: evidenceGaps } = evidenceInsight;
  const constraints = parseProjectRequirements(
    `${project.target} ${project.constraints ?? ""}`
  ).constraints;
  const opportunity = synthesizeOpportunityAnalysis({ resolved, gaps: evidenceGaps }, constraints);
  const blockingKeyGaps: string[] = [];
  if (BUSINESS_BASELINE.priceRequired && evidenceGaps.some((g) => g.fieldKey === BASELINE_FIELD.price)) {
    blockingKeyGaps.push(BASELINE_FIELD.price);
  }
  if (
    BUSINESS_BASELINE.followHitRequiresSalesVolume &&
    opportunity.type === "FOLLOW_HIT_PRODUCT" &&
    evidenceGaps.some((g) => g.fieldKey === BASELINE_FIELD.salesVolume)
  ) {
    blockingKeyGaps.push(BASELINE_FIELD.salesVolume);
  }
  const validations = project.evidences
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
        e.claims
          ?.filter((c) => c.fieldKey?.startsWith("validation."))
          .map((c) => ({ key: c.fieldKey, value: c.value, kind: c.kind, source: e.source })) ?? [],
    }));
  const initialOpportunity = {
    type: opportunity.type,
    basis: opportunity.basis,
    elements: opportunity.elements,
    blockingKeyGaps,
    validations,
  };

  return (
    <RoleProvider>
      <ProjectDetailClient
        initialProject={JSON.parse(JSON.stringify(project))}
        allUsers={JSON.parse(JSON.stringify(allUsers))}
        currentSession={toSessionView(session)}
        gaps={gaps}
        mockAuth={mockAuth}
        initialEvidenceInsight={JSON.parse(JSON.stringify(evidenceInsight))}
        initialOpportunity={JSON.parse(JSON.stringify(initialOpportunity))}
        runtime={getRuntimeStatus()}
      />
    </RoleProvider>
  );
}
