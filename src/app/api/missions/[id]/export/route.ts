/**
 * GET /api/missions/[id]/export?format=md|pdf
 * md  → Markdown download.
 * pdf → printable HTML page that opens the print dialog (save as PDF);
 *       no server-side PDF engine needed.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { loadMissionReport, missionReportHtml, missionReportMarkdown, reportFileName } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const report = await loadMissionReport(session, id);
    const md = missionReportMarkdown(report);
    if (req.nextUrl.searchParams.get("format") === "pdf") {
      return new NextResponse(missionReportHtml(report, md), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const name = reportFileName(report, "md");
    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="kern-report.md"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
