/**
 * GET  /api/playbooks — 本人保存的做法。
 * POST /api/playbooks — { missionTaskId, name? } 把一次顺利完成的工作保存为做法（重复保存幂等）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { listPlaybooks, savePlaybookFromMission } from "@/modules/playbooks/service";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ items: await listPlaybooks(session) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    if (typeof body.missionTaskId !== "string" || !body.missionTaskId) throw new UnprocessableEntityError("需要 missionTaskId");
    const r = await savePlaybookFromMission(session, body.missionTaskId, body.name);
    return NextResponse.json(r, { status: r.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
