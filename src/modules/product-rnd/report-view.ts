/**
 * Executive Report HTML 页的数据装配 —— 服务端共用。
 *
 * `/reports/[id]` 页面与 `/api/reports/[id]` 接口都从这里取数，保证两边看到的
 * 报告载荷完全一致。组织隔离 + 项目成员门禁 + 解析失败 null，调用方一律走
 * 空态/404，绝不把非法内容抛给渲染层。
 */
import prisma from "@/shared/db";
import {
  type SessionContext,
  requireProjectRole,
} from "@/modules/identity/session";
import { Role } from "@prisma/client";
import { buildExecutiveReportPreview } from "./orchestrator";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";

export const EXECUTIVE_REPORT_ARTIFACT_TYPE = "PRODUCT_RND_EXECUTIVE_REPORT";

export interface ReportViewArtifactMeta {
  id: string;
  title: string;
  contentVersion: number;
  createdAt: string;
  reviewStatus: string;
}

export interface ReportViewData {
  artifact: ReportViewArtifactMeta;
  payload: ExecutiveReportPayload;
}

export async function getExecutiveReportView(
  session: SessionContext,
  artifactId: string
): Promise<ReportViewData | null> {
  const artifact = await prisma.artifact.findFirst({
    where: {
      id: artifactId,
      organizationId: session.organizationId,
      type: EXECUTIVE_REPORT_ARTIFACT_TYPE,
    },
    select: {
      id: true,
      title: true,
      content: true,
      contentVersion: true,
      createdAt: true,
      reviewStatus: true,
      workItemId: true,
    },
  });
  if (!artifact || !artifact.workItemId) return null;

  const workItem = await prisma.workItem.findUnique({
    where: { id: artifact.workItemId },
    select: { projectId: true },
  });
  if (!workItem) return null;

  // 读门禁与现有读路径（getProductRndProgramStatus）一致：项目成员（VIEWER 起）可读。
  // 非成员抛 ForbiddenError，API 层转为 403；页面层转为 404 空态。
  await requireProjectRole(session, workItem.projectId, [
    Role.OWNER,
    Role.DECISION_MAKER,
    Role.VIEWER,
  ]);

  const preview = buildExecutiveReportPreview(artifact.content);
  if (!preview) return null;

  const createdAt = artifact.createdAt.toISOString();
  return {
    artifact: {
      id: artifact.id,
      title: artifact.title,
      contentVersion: artifact.contentVersion,
      createdAt,
      reviewStatus: artifact.reviewStatus,
    },
    payload: {
      ...preview,
      title: artifact.title,
      artifactId: artifact.id,
      contentVersion: artifact.contentVersion,
      createdAt,
    },
  };
}
