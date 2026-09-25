import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { claimDesktopRuntimeTask } from "@/modules/desktop-runtime";
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
    if (typeof body.deviceId !== "string" || !body.deviceId.trim()) {
      throw new UnprocessableEntityError("deviceId is required");
    }
    return NextResponse.json(
      await claimDesktopRuntimeTask(session, {
        taskId: id,
        deviceId: body.deviceId.trim(),
      })
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
