import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { delegateAgentTask } from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    if (
      typeof body.toAgentId !== "string" ||
      typeof body.goal !== "string" ||
      typeof body.reason !== "string"
    ) {
      throw new UnprocessableEntityError("toAgentId, goal and reason are required");
    }

    const result = await delegateAgentTask(session, {
      parentTaskId: id,
      toAgentId: body.toAgentId,
      goal: body.goal,
      reason: body.reason,
      sourceRunId: typeof body.sourceRunId === "string" ? body.sourceRunId : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
