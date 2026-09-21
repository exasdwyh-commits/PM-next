/**
 * POST /api/agent-runs/[runId]/cancel - 取消交互式运行（TASK-017）
 *
 * 根据计划 §1.9：
 * - 记录取消状态
 * - 只有运行发起人可取消
 * - 取消后不得写有效成果
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/shared/auth";
import { cancelInteractiveRun } from "@/modules/advisor/runs";
import { NotFoundError, ForbiddenError, UnprocessableEntityError } from "@/shared/errors";

export const POST = withAuth(async (req: NextRequest, session, { params }) => {
  try {
    const { runId } = params;

    if (!runId) {
      return NextResponse.json(
        { error: "缺少 runId 参数" },
        { status: 400 }
      );
    }

    const result = await cancelInteractiveRun({
      session,
      runId: runId as string,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof UnprocessableEntityError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.error("Failed to cancel agent run:", e);
    return NextResponse.json(
      { error: "取消运行失败" },
      { status: 500 }
    );
  }
});
