import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { getExecutiveReportView } from "@/modules/product-rnd/report-view";

/**
 * GET /api/reports/[id]
 * 返回某份 Executive Report 成果的负责人视图载荷（JSON）。
 * 与 /reports/[id] 页面共用同一装配函数，两边数据不可能漂移。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const view = await getExecutiveReportView(session, id);
    if (!view) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "报告不存在、类型不符或无权访问" },
        { status: 404 }
      );
    }
    return NextResponse.json(view);
  } catch (error) {
    return handleApiError(error, req);
  }
}
