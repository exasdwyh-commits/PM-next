import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import {
  getResearchRunState,
  runResearchRunTasks,
} from "@/modules/research/research-run";
import { NotFoundError } from "@/shared/errors";

/**
 * R: 研究批次状态查询（含接管续跑），供前端轮询。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { runId } = await params;

    const state = await getResearchRunState(session, runId);
    if (!state) throw new NotFoundError("Research run not found");

    // 轮询即接管执行（getResearchRunState 已对超时 running 任务重排队），此处同步跑下一个任务
    if (state.run.status === "RUNNING") {
      await runResearchRunTasks(runId);
    }

    return NextResponse.json(state);
  } catch (error) {
    return handleApiError(error, req);
  }
}