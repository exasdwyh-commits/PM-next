/**
 * GET /api/attention — 注意力信号流（KX-64）：需要你、最近完成、定时任务失败。
 * 只读、只含本人数据；前端轮询后只对新出现的条目弹浏览器系统通知。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { loadAttentionFeed } from "@/modules/muse/attention-feed";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ items: await loadAttentionFeed(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
