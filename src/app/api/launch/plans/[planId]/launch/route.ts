import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { confirmLaunchExecution } from "@/modules/launch/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 确认实际上市（与"获准"分开的一步）。
 * 必须先获准；必须带实际动作说明；可附真实存在的证据 id。
 * 成功后才把产品生命周期置为 LAUNCHED。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { planId } = await params;
    const body = await readJsonObjectBody(req);

    const result = await confirmLaunchExecution(session, planId, {
      evidenceId: body?.evidenceId ?? null,
      note: body?.note,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
