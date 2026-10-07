/**
 * GET /api/missions/[id]/export?format=md|pdf|docx|xlsx|pptx
 * md  → Markdown download.
 * pdf → printable HTML page that opens the print dialog (save as PDF);
 *       no server-side PDF engine needed.
 * docx / xlsx / pptx → KX-32 办公文件（生成后回读校验，SHA-256 放在响应头）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { loadMissionReport, missionReportHtml, missionReportMarkdown, reportFileName } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

const OFFICE = new Set(["docx", "xlsx", "pptx"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const report = await loadMissionReport(session, id);
    const format = req.nextUrl.searchParams.get("format") ?? "md";
    if (OFFICE.has(format)) {
      // 按需加载：办公库体积大，只在真的导出时才进内存。
      const { buildOfficeReport, OFFICE_MIME } = await import("@/modules/supervisor/office-export");
      const f = format as "docx" | "xlsx" | "pptx";
      const { buffer, check } = await buildOfficeReport(report, f);
      const name = reportFileName(report, f);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": OFFICE_MIME[f],
          "Content-Disposition": `attachment; filename="kern-report.${f}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "no-store",
          "X-Kern-SHA256": check.sha256,
          "X-Kern-Check": encodeURIComponent(JSON.stringify(check.detail)),
        },
      });
    }
    const md = missionReportMarkdown(report);
    if (format === "pdf") {
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
