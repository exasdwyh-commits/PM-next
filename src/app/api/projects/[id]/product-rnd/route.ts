import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import {
  advanceProductRndProgram,
  getProductRndProgramStatus,
  queueProductRndQa,
  signOffProductRndQa,
  startProductRndProgram,
  synthesizeProductRndExecutiveReport,
  type ProductRndQaVerdict,
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

    // 独立 QA 的人工复核签字入口。
    // 设计上 QA 不由 Worker 执行（见 modules/product-rnd/qa-signoff.ts 顶部说明），
    // 所以必须由负责人 / 决策人在这里显式落结论，流程才能走到报告合成。
    if (action === "SIGN_QA") {
      return NextResponse.json(
        await signOffProductRndQa(session, {
          parentTaskId: String(body?.parentTaskId ?? ""),
          verdict: body?.verdict as ProductRndQaVerdict,
          resultSummary: String(body?.resultSummary ?? ""),
          reason: typeof body?.reason === "string" ? body.reason : null,
        })
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
