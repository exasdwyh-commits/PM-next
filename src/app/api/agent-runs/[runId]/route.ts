/**
 * GET /api/agent-runs/[runId] - 获取运行状态（TASK-017）
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getRunStatus } from "@/modules/advisor/runs";
import { handleApiError } from "@/shared/api-handler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { runId } = await params;
    const result = await getRunStatus(runId, session.organizationId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
