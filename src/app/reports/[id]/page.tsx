import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { getExecutiveReportView } from "@/modules/product-rnd/report-view";
import { ReportV3 } from "@/components/report-v3";
import { NotFoundError, UnauthorizedError } from "@/shared/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "产品研发报告 · Kern" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view;
  try {
    const session = await getServerSessionFromContext(await headers(), await cookies());
    view = await getExecutiveReportView(session, id);
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return <ReportV3 report={view.report} reviewStatus={view.reviewStatus} />;
}
