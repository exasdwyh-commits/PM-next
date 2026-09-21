/**
 * POST /api/agent-runs/[runId]/cancel - 取消交互式运行（TASK-017）
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { cancelInteractiveRun } from "@/modules/advisor/runs";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { runId } = await params;
    const result = await cancelInteractiveRun({ session, runId });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
