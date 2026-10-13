import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getServerSessionFromContext } from "@/modules/identity/session";
import { loadMissionReport } from "@/modules/supervisor/takeaway";
import { buildMissionPoster } from "@/modules/supervisor/report-poster";
import { ReportV3 } from "@/components/report-v3";
import { NotFoundError, UnauthorizedError } from "@/shared/errors";

export const dynamic = "force-dynamic";
export const metadata = { title: "新产品研究报告 · Kern" };

/** This is a personal mission, NOT a project artifact: reuse requester + tenant authorization. */
export default async function MissionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let report;
  try {
    const session = await getServerSessionFromContext(await headers(), await cookies());
    report = await loadMissionReport(session, id);
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (report.playbook !== "NEW_PRODUCT" || report.outcome !== "COMPLETED" || !report.conclusion) notFound();
  return <ReportV3 report={buildMissionPoster(report)} />;
}
