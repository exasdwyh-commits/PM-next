import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createProposal, listProposals, supersedeStaleProposals } from "@/modules/advisor/proposals";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 顾问动作提议（蓝图 §5.3）
 *
 * GET  → 提议列表（可按产品 / 会话 / 状态过滤）。
 *        查询产品维度时会顺手把"依据版本已失效"的待确认提议标为 SUPERSEDED，
 *        避免界面上出现"看起来能点、点了必然失败"的提议。
 * POST → 新建待确认提议（幂等键可由 Idempotency-Key 头或 body.idempotencyKey 传入）。
 *        **此接口不执行任何业务写入**，写入只发生在 /confirm。
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const sp = req.nextUrl.searchParams;
    const productId = sp.get("productId");

    let superseded = 0;
    if (productId) {
      const r = await supersedeStaleProposals(session, productId);
      superseded = r.superseded;
    }

    const items = await listProposals(session, {
      productId,
      conversationId: sp.get("conversationId"),
      status: sp.get("status"),
      take: sp.get("take") ? Number(sp.get("take")) : undefined,
    });

    return NextResponse.json({ items, supersededStale: superseded });
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
