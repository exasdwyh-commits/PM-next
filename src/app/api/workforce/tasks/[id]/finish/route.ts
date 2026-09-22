import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  finishAgentTask,
  type AgentTaskOutcome,
} from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

const OUTCOMES: AgentTaskOutcome[] = [
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "WAITING_HUMAN",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    if (
      typeof body.runId !== "string" ||
      typeof body.outcome !== "string" ||
      !OUTCOMES.includes(body.outcome as AgentTaskOutcome)
    ) {
      throw new UnprocessableEntityError("runId and valid outcome are required");
    }

    return NextResponse.json(
      await finishAgentTask(session, id, {
        runId: body.runId,
        outcome: body.outcome as AgentTaskOutcome,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      })
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
