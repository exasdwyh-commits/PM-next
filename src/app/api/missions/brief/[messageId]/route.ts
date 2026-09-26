/**
 * GET  /api/missions/brief/[messageId] — the clarify/plan brief on a Kern message.
 * POST /api/missions/brief/[messageId] — answer / skip-questions / back / edit-plan / launch {demo?} / dismiss.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { actOnBrief, getBrief, parseBriefAction } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

type Ctx = { params: Promise<{ messageId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { messageId } = await params;
    return NextResponse.json({ ...(await getBrief(session, messageId)), messageId });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { messageId } = await params;
    const action = parseBriefAction(await req.json().catch(() => null));
    return NextResponse.json(await actOnBrief(session, messageId, action));
  } catch (error) {
    return handleApiError(error, req);
  }
}
