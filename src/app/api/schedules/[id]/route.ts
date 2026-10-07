/**
 * PATCH  /api/schedules/[id] — { enabled?, cron?, timezone?, title? }。
 * DELETE /api/schedules/[id] — 删除。仅本人，他人一律 404。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { deleteSchedule, updateSchedule } from "@/modules/schedule/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    return NextResponse.json({ item: await updateSchedule(session, id, body) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    await deleteSchedule(session, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
