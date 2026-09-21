import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getLaunchContext, prepareLaunch } from "@/modules/launch/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 上市计划（蓝图 §4.3、§4.5）
 * GET  → 计划 + 候选负责人 + 服务端算好的放行门禁
 * POST → 建立计划（必须带负责人与目标日期）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    return NextResponse.json(await getLaunchContext(session, productId));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const body = await readJsonObjectBody(req);

    const result = await prepareLaunch(session, {
      productId,
      title: body?.title,
      targetDate: body?.targetDate ?? null,
      ownerId: body?.ownerId,
      notes: body?.notes ?? null,
      projectId: body?.projectId ?? null,
      milestones: Array.isArray(body?.milestones) ? body.milestones : [],
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
