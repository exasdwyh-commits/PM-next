import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { updateLaunchBasics } from "@/modules/launch/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/** 更新上市计划基本信息（标题/目标日期/负责人/备注） */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { planId } = await params;
    const body = await readJsonObjectBody(req);

    await updateLaunchBasics(session, planId, {
      title: body?.title,
      targetDate: body?.targetDate,
      ownerId: body?.ownerId,
      notes: body?.notes,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
