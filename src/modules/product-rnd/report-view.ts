import { Role } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import { requireProjectRole, type SessionContext } from "@/modules/identity/session";
import { buildExecutiveReportPreview } from "./orchestrator";

/** Report reads inherit the project's existing roles and tenant boundary. */
export async function getExecutiveReportView(session: SessionContext, id: string) {
  const artifact = await prisma.artifact.findFirst({
    where: {
      id, type: "PRODUCT_RND_EXECUTIVE_REPORT",
      OR: [{ organizationId: session.organizationId }, { organizationId: null }],
      workItem: { project: { organizationId: session.organizationId } },
    },
    select: { id: true, title: true, content: true, contentVersion: true, reviewStatus: true, createdAt: true, workItem: { select: { projectId: true } } },
  });
  if (!artifact?.workItem) throw new NotFoundError("Report not found");
  try {
    await requireProjectRole(session, artifact.workItem.projectId, [Role.OWNER, Role.DECISION_MAKER, Role.VIEWER]);
  } catch { throw new NotFoundError("Report not found"); }
  let parsed;
  try { parsed = JSON.parse(artifact.content); } catch { throw new NotFoundError("Report not found"); }
  if (parsed?.schemaVersion !== "1.0") throw new NotFoundError("Report not found");
  const preview = buildExecutiveReportPreview(artifact.content);
  if (!preview) throw new NotFoundError("Report not found");
  return {
    report: { ...preview, artifactId: artifact.id, title: artifact.title, contentVersion: artifact.contentVersion, createdAt: artifact.createdAt.toISOString() },
    reviewStatus: artifact.reviewStatus,
  };
}
