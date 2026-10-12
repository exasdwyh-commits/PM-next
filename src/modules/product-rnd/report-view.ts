import { Role } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import { requireProjectRole, type SessionContext } from "@/modules/identity/session";
import { buildExecutiveReportPreview } from "./orchestrator";

/**
 * 可读取的 Executive Report 载荷版本。
 *
 * - `"1.0"`：orchestrator 写出的 canonical 版本（`PRODUCT_RND_EXECUTIVE_REPORT`）。
 * - `"product-rnd-executive-report/v1"`：2026-10-12 之前回归夹具与早期数据使用的别名，
 *   读取端继续兼容，避免历史报告在 /reports/[id] 上 404。
 *
 * 写入端不在这个文件里 —— 它只负责**读**，所以放宽在这里是安全的；未知版本仍然 404。
 */
export const EXECUTIVE_REPORT_SCHEMA_VERSIONS: ReadonlySet<string> = new Set([
  "1.0",
  "product-rnd-executive-report/v1",
]);

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
  // 已知的报告载荷版本：orchestrator 写的是 canonical "1.0"；
  // 2026-10-12 之前的部分夹具/早期数据用的是 "product-rnd-executive-report/v1"。
  // 读取端接受别名（写端仍只写 canonical），未知版本继续 fail closed。
  if (typeof parsed?.schemaVersion !== "string" || !EXECUTIVE_REPORT_SCHEMA_VERSIONS.has(parsed.schemaVersion)) {
    throw new NotFoundError("Report not found");
  }
  const preview = buildExecutiveReportPreview(artifact.content);
  if (!preview) throw new NotFoundError("Report not found");
  return {
    report: { ...preview, artifactId: artifact.id, title: artifact.title, contentVersion: artifact.contentVersion, createdAt: artifact.createdAt.toISOString() },
    reviewStatus: artifact.reviewStatus,
  };
}
