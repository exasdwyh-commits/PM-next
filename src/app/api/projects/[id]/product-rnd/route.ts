import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import {
  advanceProductRndProgram,
  getProductRndProgramStatus,
  queueProductRndQa,
  startProductRndProgram,
  synthesizeProductRndExecutiveReport,
} from "@/modules/product-rnd";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;
    const workItemId = req.nextUrl.searchParams.get("workItemId");
    if (!workItemId) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "workItemId is required" },
        { status: 422 }
      );
    }
    return NextResponse.json(
      await getProductRndProgramStatus(session, { projectId, workItemId })
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: projectId } = await params;
    const body = await readJsonObjectBody(req);
    const action = String(body?.action ?? "START");

    if (action === "START") {
      return NextResponse.json(
        await startProductRndProgram(session, {
          projectId,
          brief: String(body?.brief ?? ""),
        }),
        { status: 201 }
      );
    }

    if (action === "RECONCILE") {
      return NextResponse.json(
        await advanceProductRndProgram(
          session,
          String(body?.parentTaskId ?? "")
        )
      );
    }

    if (action === "QUEUE_QA") {
      return NextResponse.json(
        await queueProductRndQa(session, {
          parentTaskId: String(body?.parentTaskId ?? ""),
        }),
        { status: 201 }
      );
    }

    if (action === "SYNTHESIZE") {
      return NextResponse.json(
        await synthesizeProductRndExecutiveReport(session, {
          projectId,
          workItemId: String(body?.workItemId ?? ""),
          parentTaskId: String(body?.parentTaskId ?? ""),
        }),
        { status: 201 }
      );
    }

    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "Unsupported action" },
      { status: 422 }
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
