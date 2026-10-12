/**
 * 批次 D：事后回填通道。
 *
 * 把「这家公司真实发生过什么」记回来（OEM 报价区间 / 检测周期 / 试销转化率 …）。
 * 回填值在合成层是**与静态条目并列的一条命中**，共享 conflictGroup，
 * 于是会呈现「教科书值 vs 本公司实测值」—— 而不是悄悄改写条规。
 *
 * `sourceRef` 必填：没有实测来源的数字不落库。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { createBackfill, listBackfills, normalizeBackfillInput } from "@/modules/knowledge/module-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const backfills = await listBackfills(session.organizationId, {
      metricKey: searchParams.get("metricKey") ?? undefined,
      entryId: searchParams.get("entryId") ?? undefined,
    });
    return NextResponse.json({ backfills, count: backfills.length });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const input = normalizeBackfillInput(body);
    const backfill = await createBackfill(session.organizationId, session.userId, input);
    return NextResponse.json({ backfill }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
