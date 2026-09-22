import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  resolveReturnedChildReview,
  type ReturnedChildReviewAction,
} from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

const ACTIONS: ReturnedChildReviewAction[] = [
  "ACCEPT_RESULT",
  "CONTINUE_DELEGATION",
  "ESCALATE_HUMAN",
  "CLOSE_PARENT",
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
      typeof body.action !== "string" ||
      !ACTIONS.includes(body.action as ReturnedChildReviewAction)
    ) {
      throw new UnprocessableEntityError("valid action is required");
    }

    return NextResponse.json(
      await resolveReturnedChildReview(session, id, {
        action: body.action as ReturnedChildReviewAction,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        toAgentId:
          typeof body.toAgentId === "string" ? body.toAgentId : undefined,
        goal: typeof body.goal === "string" ? body.goal : undefined,
      })
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
