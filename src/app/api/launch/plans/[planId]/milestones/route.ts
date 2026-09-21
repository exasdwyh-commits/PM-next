import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { upsertMilestone } from "@/modules/launch/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 新增或更新里程碑。
 * 标记为 BLOCKED 时必须带阻塞原因（服务端强制），否则门禁会失去意义。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { planId } = await params;
    const body = await readJsonObjectBody(req);

    const result = await upsertMilestone(session, planId, {
      id: body?.id,
      title: body?.title,
      kind: body?.kind,
      dueDate: body?.dueDate,
      ownerId: body?.ownerId,
      status: body?.status,
      blockerReason: body?.blockerReason,
      workItemId: body?.workItemId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
