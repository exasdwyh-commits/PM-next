/**
 * POST /api/agent-runs - 创建交互式运行（TASK-017）
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { prepareInteractiveRun, type InteractiveRunPurpose } from "@/modules/advisor/runs";
import { UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const purpose = body.purpose as InteractiveRunPurpose | undefined;

    if (!purpose) {
      throw new UnprocessableEntityError("缺少必需字段：purpose");
    }
    const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
    if (!validPurposes.includes(purpose)) {
      throw new UnprocessableEntityError(
        `无效的用途：${String(body.purpose)}。允许的值：${validPurposes.join(", ")}`
      );
    }

    const result = await prepareInteractiveRun({
      session,
      purpose,
      conversationId: body.conversationId,
      productId: body.productId,
      productVersionId: body.productVersionId,
      goal: body.goal,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
