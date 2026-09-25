import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { finishDesktopRuntimeTask } from "@/modules/desktop-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";
import type { DesktopRuntimeResult } from "@/modules/desktop-runtime";

const OUTCOMES = ["SUCCEEDED", "FAILED", "BLOCKED", "WAITING_HUMAN"] as const;
type Outcome = (typeof OUTCOMES)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);

    if (
      typeof body.deviceId !== "string" ||
      typeof body.runId !== "string" ||
      typeof body.outcome !== "string" ||
      !OUTCOMES.includes(body.outcome as Outcome) ||
      !body.result ||
      typeof body.result !== "object" ||
      Array.isArray(body.result)
    ) {
      throw new UnprocessableEntityError(
        "deviceId, runId, valid outcome and result are required"
      );
    }

    return NextResponse.json(
      await finishDesktopRuntimeTask(session, {
        taskId: id,
        deviceId: body.deviceId,
        runId: body.runId,
        outcome: body.outcome as Outcome,
        result: body.result as unknown as DesktopRuntimeResult,
      })
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
