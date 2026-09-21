import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { applyProposal } from "@/modules/advisor/proposals";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 确认并应用顾问提议（蓝图 §5.3：提议 → 权限和版本检查 → 用户确认 → 业务命令 → 回执）
 *
 * 幂等：客户端应带上稳定的 `Idempotency-Key` 请求头。
 * 同一键重复提交直接返回首次回执，不产生第二次业务写入。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);

    const receipt = await applyProposal(session, id, {
      idempotencyKey: req.headers.get("Idempotency-Key") ?? body?.idempotencyKey ?? null,
      reason: body?.reason ?? null,
    });

    return NextResponse.json(receipt);
  } catch (error) {
    return handleApiError(error, req);
  }
}
