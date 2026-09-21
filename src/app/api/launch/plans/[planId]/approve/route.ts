import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { approveLaunch, revokeLaunchApproval } from "@/modules/launch/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 放行（获准）。
 * POST → 通过门禁后写 approvedAt。**不会**把产品标为已上市。
 * DELETE → 撤销获准（必须给原因）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { planId } = await params;
    const body = await readJsonObjectBody(req);
    const result = await approveLaunch(session, planId, body?.note ?? null);
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
