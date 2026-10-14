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
import { assessMissionReportQuality, REPORT_QUALITY_LABEL } from "@/modules/supervisor/report-quality";
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
    // 交付与展示同源：下载件也带上质量状态，不让未通过的结论以正式报告的样子流出。
    const quality = report.playbook === "NEW_PRODUCT" && report.outcome === "COMPLETED" && report.conclusion
      ? assessMissionReportQuality(report) : null;
    const gate = quality && quality.status !== "DELIVERABLE"
      ? [`> **${REPORT_QUALITY_LABEL[quality.status]}**：${quality.status === "BLOCKED" ? "这份报告不能作为正式研究交付。" : "这份报告还需补证才能定稿。"}`,
         ...quality.issues.map((issue) => `> - ${issue.where}：${issue.detail}（补齐方式：${issue.fix}）`), ""]
      : [];
    const md0 = missionReportMarkdown(report);
    const md = gate.length ? md0.replace(/^([^\n]*\n)/, `$1\n${gate.join("\n")}\n`) : md0;
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
