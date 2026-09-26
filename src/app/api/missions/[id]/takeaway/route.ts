/**
 * GET  /api/missions/[id]/takeaway → what can be taken away (or why not).
 * POST /api/missions/[id]/takeaway {target:"product"|"work-item"} → proposal
 *      (idempotent); the user confirms it through the normal proposal flow.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { proposeMissionTakeaway, takeawayOptions } from "@/modules/supervisor";
import { UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await takeawayOptions(session, id));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { target?: unknown };
    if (body.target !== "product" && body.target !== "work-item") throw new UnprocessableEntityError("target 必须是 product 或 work-item");
    return NextResponse.json(await proposeMissionTakeaway(session, { missionTaskId: id, target: body.target }));
  } catch (error) {
    return handleApiError(error, req);
  }
}
