/**
 * POST /api/agent-runs - 创建交互式运行（TASK-017）
 *
 * 根据计划 §1.9：
 * - 仅创建受权 AgentRun 并返回 runId
 * - 初始化限定用途：ADVISOR_MESSAGE / PROFESSIONAL_ANALYSIS
 * - 上下文只接受经服务器校验的 conversationId/productId/versionId
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/shared/auth";
import { prepareInteractiveRun, type InteractiveRunPurpose } from "@/modules/advisor/runs";
import { UnprocessableEntityError } from "@/shared/errors";

export const POST = withAuth(async (req: NextRequest, session) => {
  try {
    const body = await req.json();
    const { purpose, conversationId, productId, productVersionId, goal } = body;

    // 校验必需字段
    if (!purpose) {
      return NextResponse.json(
        { error: "缺少必需字段：purpose" },
        { status: 422 }
      );
    }

    // 校验用途值
    const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
    if (!validPurposes.includes(purpose)) {
      return NextResponse.json(
        { error: `无效的用途：${purpose}。允许的值：${validPurposes.join(", ")}` },
        { status: 422 }
      );
    }

    const result = await prepareInteractiveRun({
      session,
      purpose,
      conversationId,
      productId,
      productVersionId,
      goal,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e: any) {
    if (e instanceof UnprocessableEntityError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    if (e?.name === "NotFoundError") {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e?.name === "ForbiddenError") {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    console.error("Failed to create agent run:", e);
    return NextResponse.json(
      { error: "创建运行失败" },
      { status: 500 }
    );
  }
});
