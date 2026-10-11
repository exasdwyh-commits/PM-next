import { notFound } from "next/navigation";
import { headers, cookies } from "next/headers";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getExecutiveReportView } from "@/modules/product-rnd/report-view";
import { ReportMagazine } from "@/components/report-magazine";
import { fmtDateTime } from "@/shared/datetime";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "产品研发报告 · Kern",
};

/**
 * /reports/[id] —— Executive Report 成果的独立 HTML 页（杂志风版式）。
 * 数据来自 artifact（PRODUCT_RND_EXECUTIVE_REPORT），经组织隔离后渲染；
 * 不存在、无权或内容非法时走 404 空态，绝不渲染半截报告。
 */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let view;
  try {
    const session = await getServerSessionFromContext(await headers(), await cookies());
    view = await getExecutiveReportView(session, id);
  } catch {
    // 未登录、无权或报告不存在：一律 404 空态，不泄露存在性
    notFound();
  }
  if (!view) notFound();

  return (
    <ReportMagazine
      payload={view.payload}
      meta={{
        title: view.artifact.title,
        contentVersion: view.artifact.contentVersion,
        reviewStatus: view.artifact.reviewStatus,
        createdAtLabel: fmtDateTime(view.artifact.createdAt),
      }}
    />
  );
}
