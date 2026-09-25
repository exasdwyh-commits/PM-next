import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getDesktopOverview } from "@/modules/desktop-runtime";
import { handleApiError } from "@/shared/api-handler";

/**
 * 面向用户的本机执行视图（对话内运行条 / 自动化中心「本机执行」面板）。
 * 只读：不排队、不领取、不改任何任务状态。
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const conversationId =
      req.nextUrl.searchParams.get("conversationId")?.trim() || null;
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") || "12");
    const overview = await getDesktopOverview(session, {
      conversationId,
      limit: Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 12,
    });
    return NextResponse.json(overview);
  } catch (error) {
    return handleApiError(error, req);
  }
}
