import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createProposal, listProposals } from "@/modules/advisor/proposals";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 顾问动作提议（蓝图 §5.3）
 *
 * GET  → 提议列表（可按产品 / 会话 / 状态过滤）。
 *        只读，不修改 proposal 状态；过期版本通过 items[].isStale 显式提示。
 *        真正作废属于治理写命令，不能藏在 GET 请求里。
 * POST → 新建待确认提议（幂等键可由 Idempotency-Key 头或 body.idempotencyKey 传入）。
 *        **此接口不执行任何业务写入**，写入只发生在 /confirm。
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const sp = req.nextUrl.searchParams;
    const productId = sp.get("productId");

    const items = await listProposals(session, {
      productId,
      conversationId: sp.get("conversationId"),
      status: sp.get("status"),
      take: sp.get("take") ? Number(sp.get("take")) : undefined,
    });

    const staleDetected = items.filter((item) => item.isStale).length;
    return NextResponse.json({
      items,
      staleDetected,
      // 兼容旧客户端字段；GET 不再产生写副作用，因此固定为 0。
      supersededStale: 0,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);

    const result = await createProposal(session, {
      actionType: body?.actionType,
      payload: body?.payload,
      productId: body?.productId ?? null,
      projectId: body?.projectId ?? null,
      conversationId: body?.conversationId ?? null,
      runId: body?.runId ?? null,
      idempotencyKey: req.headers.get("Idempotency-Key") ?? body?.idempotencyKey ?? null,
      rationale: body?.rationale ?? null,
    });

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
