import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  createRevision,
  listAnalysisHistory,
  proposeRevisionOptions,
} from "@/modules/product-development/revision";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 多轮优化（蓝图 §4.4）
 *
 * GET  → 可采纳项（由最新分析缺口推导）+ 历史分析轮次（版本轨迹）
 * POST → 采纳选定字段，创建下一版本（v1 不被覆盖）并对受影响维度重评
 *
 * 说明：本模块是**确定性规则**，不调用模型；不承诺分数上升，只如实给出
 * 「改了哪些字段 / 影响哪些维度 / 变更前后是什么 / 代价是什么」。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const [proposal, history] = await Promise.all([
      proposeRevisionOptions(session, productId),
      listAnalysisHistory(session, productId),
    ]);
    return NextResponse.json({ ...proposal, history });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const body = await readJsonObjectBody(req);

    const result = await createRevision(session, {
      productId,
      baseVersionId: body?.baseVersionId,
      adoptedKeys: Array.isArray(body?.adoptedKeys) ? body.adoptedKeys : [],
      changes: body?.changes && typeof body.changes === "object" ? body.changes : {},
      rejected: Array.isArray(body?.rejected) ? body.rejected : [],
      note: body?.note ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
