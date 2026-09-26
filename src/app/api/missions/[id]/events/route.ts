/**
 * GET /api/missions/[id]/events?after=<seq> — ordered mission events (catch-up / polling fallback).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { listMissionEvents } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const after = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("after") ?? "0", 10) || 0);
    const events = await listMissionEvents(session, id, after);
    return NextResponse.json({ events, lastSeq: events.at(-1)?.seq ?? after });
  } catch (error) {
    return handleApiError(error, req);
  }
}
