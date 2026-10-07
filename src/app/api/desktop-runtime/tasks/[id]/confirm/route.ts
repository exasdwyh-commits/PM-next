import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { confirmDesktopTask } from "@/modules/desktop-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

/** KX-35 确认卡：{ decision: "ALLOW" | "DENY" }。ALLOW = 允许一次（单次 ApprovalGrant）。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    if (body.decision !== "ALLOW" && body.decision !== "DENY") {
      throw new UnprocessableEntityError("decision must be ALLOW or DENY");
    }
    return NextResponse.json(
      await confirmDesktopTask(session, { taskId: id, decision: body.decision })
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
