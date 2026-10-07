/**
 * GET /api/worker/health — 后台 Worker 是否在运行（定时与任务推进都依赖它）。
 * 任何登录用户可读；只返回状态与时间，不暴露主机名 / pid。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getWorkerHealth } from "@/modules/worker/heartbeat";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await getWorkerHealth(new Date(), { organizationId: session.organizationId }));
  } catch (error) {
    return handleApiError(error, req);
  }
}
