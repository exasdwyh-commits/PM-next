/**
 * POST /api/missions/[id]/roundtrip （KX-32 往返，C6）
 * multipart 字段 file（.docx / .xlsx）：把用户已有的办公文件读回来，
 * 以本任务报告的结论追加一节「Kern 分析」后返回新文件 —— 原有内容保留，
 * 回写后已在模块内回读核对，SHA-256 放在响应头（与导出路由同口径）。
 * 既有导出行为不变；pptx 往返未做，上传 pptx 明确拒绝而非静默降级。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { loadMissionReport } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError, UnsupportedMediaTypeError } from "@/shared/errors";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB：往返是办公文档，不是附件仓

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    // 先过任务可见性（与导出同一道门）：无权访问的任务在这里就被 loadMissionReport 拒掉。
    const report = await loadMissionReport(session, id);

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new UnsupportedMediaTypeError("往返上传需使用 multipart/form-data（字段：file）");
    }
    const file = formData.get("file") as File | null;
    if (!file) throw new UnprocessableEntityError("未提供 file 字段");
    if (file.size > MAX_FILE_SIZE) {
      throw new UnprocessableEntityError(`文件超过 10MB 上限（实际 ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
    }

    const { officeImportFormat } = await import("@/modules/supervisor/office-import");
    const format = officeImportFormat(file.name);
    if (!format) {
      throw new UnprocessableEntityError("往返仅支持 .docx / .xlsx（pptx 往返尚未实现）");
    }

    const { appendAnalysisToDocx, appendAnalysisToXlsx } = await import("@/modules/supervisor/office-roundtrip");
    const { keyPoints, reportTables, OFFICE_MIME } = await import("@/modules/supervisor/office-export");

    const lines = keyPoints(report.conclusion, 6);
    if (report.recommendation) lines.push(`建议：${report.recommendation}`);
    if (report.decision) lines.push(`待决定：${report.decision}`);
    const firstTable = reportTables(report)[0];
    const section: Parameters<typeof appendAnalysisToXlsx>[1] = {
      title: "Kern 分析",
      lines: lines.length ? lines : ["（本任务暂无综合结论）"],
      table: firstTable
        ? { header: firstTable.header, rows: firstTable.rows.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c))) }
        : undefined,
    };

    const src = Buffer.from(await file.arrayBuffer());
    const result =
      format === "xlsx" ? await appendAnalysisToXlsx(src, section) : await appendAnalysisToDocx(src, section);
    const outName = file.name.replace(/\.(docx|xlsx)$/i, `-kern.$1`);
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": OFFICE_MIME[format],
        "Content-Disposition": `attachment; filename="kern-roundtrip.${format}"; filename*=UTF-8''${encodeURIComponent(outName)}`,
        "Cache-Control": "no-store",
        "X-Kern-SHA256": result.check.sha256,
        "X-Kern-Check": encodeURIComponent(JSON.stringify(result.check.detail)),
      },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
