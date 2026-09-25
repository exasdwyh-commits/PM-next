import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  enqueueDesktopTask,
  listDesktopRuntimeTasks,
} from "@/modules/desktop-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const deviceId = req.nextUrl.searchParams.get("deviceId")?.trim();
    if (!deviceId) {
      throw new UnprocessableEntityError("deviceId is required");
    }
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") || "3");
    const limit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 3;
    const tasks = await listDesktopRuntimeTasks(session, { deviceId, limit });
    return NextResponse.json({ tasks });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    if (typeof body.instruction !== "string") {
      throw new UnprocessableEntityError("instruction is required");
    }
    const result = await enqueueDesktopTask(session, {
      instruction: body.instruction,
      conversationId:
        typeof body.conversationId === "string" ? body.conversationId : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
