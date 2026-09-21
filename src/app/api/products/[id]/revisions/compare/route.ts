import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { compareRevisions } from "@/modules/product-development/revision";
import { handleApiError } from "@/shared/api-handler";

/**
 * 两轮分析对比（蓝图 §4.4「显示变更前后与代价」）
 * 历史 run 不可被覆盖，因此这里按 runId 精确取两轮结果做对比，而不是拿"最新"当"变更前"。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const url = new URL(req.url);
    const before = url.searchParams.get("before");
    const after = url.searchParams.get("after");

    if (!before || !after) {
      return NextResponse.json(
        { message: "需要同时提供 before 与 after 两个分析轮次 id" },
        { status: 400 }
      );
    }

    const comparison = await compareRevisions(session, before, after);
    // 产品维度校验：避免拿 A 产品的两个 run 去渲染 B 产品的页面
    const run = await prisma.analysisRun.findUnique({ where: { id: after }, select: { productId: true } });
    if (!run || run.productId !== productId) {
      return NextResponse.json({ message: "分析轮次不属于该产品" }, { status: 400 });
    }

    return NextResponse.json(comparison);
  } catch (error) {
    return handleApiError(error, req);
  }
}
