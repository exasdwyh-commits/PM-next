import { Role } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import { requireProjectRole, type SessionContext } from "@/modules/identity/session";
import { buildExecutiveReportPreview } from "./orchestrator";
import { readQuality } from "@/shared/report-quality-store";

/**
 * 可读取的 Executive Report 版本标识。
 *
 * - `"1.0"`：orchestrator 写出的 canonical 版本 —— prisma schema 注释（契约 I-003）
 *   声明 artifact 列与 payload 顶层 `schemaVersion` **同源**。
 * - `"product-rnd-executive-report/v1"`：2026-09-25 引入「对话里读持久化报告」时的
 *   历史标识。那一代数据只把这个值写在 artifact 列上，payload 里没有 schemaVersion
 *   字段；今天的产品代码不再写它，但已落库的报告必须继续读得出来。
 *
 * 未知版本仍然 404 —— 这里放宽的只是「旧行怎么识别」，不是「什么都放行」。
 */
export const EXECUTIVE_REPORT_SCHEMA_VERSIONS: ReadonlySet<string> = new Set([
  "1.0",
  "product-rnd-executive-report/v1",
]);

export function isKnownExecutiveReportVersion(raw: unknown): boolean {
  return typeof raw === "string" && EXECUTIVE_REPORT_SCHEMA_VERSIONS.has(raw);
}

/** Report reads inherit the project's existing roles and tenant boundary. */
export async function getExecutiveReportView(session: SessionContext, id: string) {
  const artifact = await prisma.artifact.findFirst({
    where: {
      id, type: "PRODUCT_RND_EXECUTIVE_REPORT",
      OR: [{ organizationId: session.organizationId }, { organizationId: null }],
      workItem: { project: { organizationId: session.organizationId } },
    },
    select: { id: true, title: true, content: true, contentVersion: true, schemaVersion: true, reviewStatus: true, createdAt: true, workItem: { select: { projectId: true } } },
  });
  if (!artifact?.workItem) throw new NotFoundError("Report not found");
  try {
    await requireProjectRole(session, artifact.workItem.projectId, [Role.OWNER, Role.DECISION_MAKER, Role.VIEWER]);
  } catch { throw new NotFoundError("Report not found"); }
  let parsed;
  try { parsed = JSON.parse(artifact.content); } catch { throw new NotFoundError("Report not found"); }
  // 版本识别：payload 顶层优先；历史行没有该字段时回落到 artifact 列（契约 I-003：二者同源）。
  const version = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion ?? artifact.schemaVersion;
  if (!isKnownExecutiveReportVersion(version)) throw new NotFoundError("Report not found");
  const preview = buildExecutiveReportPreview(artifact.content);
  if (!preview) throw new NotFoundError("Report not found");
  // 质量状态随内容一起存档；读不到就明确说「还没经过当前质量检查」，绝不伪造通过。
  const quality = readQuality(artifact.content);
  return {
    report: { ...preview, artifactId: artifact.id, title: artifact.title, contentVersion: artifact.contentVersion, createdAt: artifact.createdAt.toISOString() },
    reviewStatus: artifact.reviewStatus,
    quality,
    qualityNote: quality ? null : "这份报告还没有经过当前质量检查；没有检查记录不等于通过。",
  };
}
