/**
 * GET /api/agent-runs/[runId] - 获取运行状态（TASK-017）
 *
 * 根据计划 §1.9：
 * - GET 不修改数据
 * - 超过 TTL 的 QUEUED 运行显示 "EXPIRED" 状态
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/shared/auth";
import { getRunStatus } from "@/modules/advisor/runs";
import { NotFoundError } from "@/shared/errors";

export const GET = withAuth(async (req: NextRequest, session, { params }) => {
  try {
    const { runId } = params;

    if (!runId) {
      return NextResponse.json(
        { error: "缺少 runId 参数" },
        { status: 400 }
      );
    }

    const result = await getRunStatus(runId as string, session.organizationId);

    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("Failed to get run status:", e);
    return NextResponse.json(
      { error: "获取运行状态失败" },
      { status: 500 }
    );
  }
});
