import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { requestFormalG3Approval, revokeLaunchApproval } from "@/modules/launch/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 正式 G3 上市授权入口。
 * POST → 负责人提交 LAUNCH_GATE 决策包并送审，不直接写批准状态。
 * DELETE → 仅保留对历史 LEGACY_APPROVAL 的撤销；正式 G3 决策不可删除。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { planId } = await params;
    await readJsonObjectBody(req);
    const result = await requestFormalG3Approval(session, planId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { planId } = await params;
    const body = await readJsonObjectBody(req);
    await revokeLaunchApproval(session, planId, body?.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
