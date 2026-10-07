/**
 * GET  /api/schedules — 当前用户的定时（每日简报 / 提醒 / 定时重跑）。
 * POST /api/schedules — 新建 { kind, cron, timezone?, title?, text?, missionTaskId?, conversationId? }。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createSchedule, listSchedules, parseCreateSchedule } from "@/modules/schedule/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ items: await listSchedules(session) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const item = await createSchedule(session, parseCreateSchedule(body));
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
