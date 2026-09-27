/**
 * GET /api/missions/[id]/response
 * The mission's ResponseEnvelope (docs/KERN_RESPONSE_SPEC.md) plus harness
 * issues, so the client never renders an envelope the server rejected.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { validate } from "@/modules/response-format/validate";
import { missionResponseEnvelope } from "@/modules/supervisor";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const envelope = await missionResponseEnvelope(session, id);
    const issues = validate(envelope);
    return NextResponse.json(
      { envelope, issues, renderable: !issues.some((i) => i.level === "error") },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
