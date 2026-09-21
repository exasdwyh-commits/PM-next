import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import {
  getLatestPublishedRun,
  startResearchRun,
  runResearchRunTasks,
} from "@/modules/research/research-run";

/**
 * R: 五阶段研究编排 · 项目级入口
 *
 * POST: 负责人(OWNER)发起一次研究批次（幂等：存在 RUNNING 批次则直接返回），
 *       落库 7 个任务后立即排程执行，返回批次与任务（前端轮询状态）。
 * GET:  返回该项目最近一次已发布的研究快照（供项目详情展示）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;
    const body = await req.json();
    const question =
      typeof body?.question === "string" && body.question.trim()
        ? body.question.trim()
        : null;
    if (!question) {
      throw new UnprocessableEntityError("question is required");
    }

    const { run, tasks, created } = await startResearchRun(session, {
      projectId,
      question,
    });

    // 新一轮(created)或(created=false 但仍有 queued 任务)都尝试承接执行
    await runResearchRunTasks(run.id);

    return NextResponse.json({ run, tasks, created });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;
    const latest = await getLatestPublishedRun(session, projectId);
    return NextResponse.json(latest);
  } catch (error) {
    return handleApiError(error, req);
  }
}