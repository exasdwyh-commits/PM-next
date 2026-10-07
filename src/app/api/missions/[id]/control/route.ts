/**
 * POST /api/missions/[id]/control — user interventions on a running mission.
 * Body: { action: "pause" | "resume" | "cancel" | "skip" | "rerun" | "edit-plan" | "add-input", ... }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { controlKernMission, parseMissionControl } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const control = parseMissionControl(await readJsonObjectBody(req));
    return NextResponse.json(await controlKernMission(session, id, control));
  } catch (error) {
    return handleApiError(error, req);
  }
}
