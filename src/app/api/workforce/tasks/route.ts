import { AgentTriggerType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createAgentTask } from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

function parseTriggerType(value: unknown): AgentTriggerType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value === "string" &&
    Object.values(AgentTriggerType).includes(value as AgentTriggerType)
  ) {
    return value as AgentTriggerType;
  }
  throw new UnprocessableEntityError("Invalid triggerType");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    if (typeof body.agentId !== "string" || typeof body.goal !== "string") {
      throw new UnprocessableEntityError("agentId and goal are required");
    }

    const task = await createAgentTask(session, {
      agentId: body.agentId,
      workItemId: typeof body.workItemId === "string" ? body.workItemId : undefined,
      squadId: typeof body.squadId === "string" ? body.squadId : undefined,
      goal: body.goal,
      contextSnapshot:
        body.contextSnapshot && typeof body.contextSnapshot === "object"
          ? body.contextSnapshot
          : undefined,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      triggerType: parseTriggerType(body.triggerType),
      triggerRef: typeof body.triggerRef === "string" ? body.triggerRef : undefined,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
