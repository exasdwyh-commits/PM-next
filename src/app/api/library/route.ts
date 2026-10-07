/**
 * GET /api/library?q= — 产出库（KX-62）：当前用户自己已完成的任务及其可下载格式。
 * 只读；只列本人发起的任务，其他人（含同组织）看不到。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { listLibrary } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const items = await listLibrary(session, { q: req.nextUrl.searchParams.get("q") });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
