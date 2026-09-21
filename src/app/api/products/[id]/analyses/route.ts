import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { analyzeProductVersion } from "@/modules/product-development/analysis";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 对某个产品版本运行分析（蓝图 §4.4）
 * 说明：当前为**确定性规则合成**（runMode=MANUAL），未调用任何模型；
 * 历史 run 不会被覆盖，新 run 通过 supersedesRunId 指向被替代者。
 *
 * TASK-016 扩展：支持专业分析请求，需要提供 agentRunId。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const body = await readJsonObjectBody(req);

    const runId = await analyzeProductVersion(session, {
      productId,
      productVersionId: body?.productVersionId,
      kind: body?.kind === "REVISION_REVIEW" ? "REVISION_REVIEW" : "BASELINE",
      supersedesRunId: body?.supersedesRunId,
      agentRunId: body?.agentRunId,
      requestProfessionalAnalysis: body?.requestProfessionalAnalysis === true,
    });

    return NextResponse.json({ runId, runMode: "MANUAL" }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
