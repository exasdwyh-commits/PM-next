import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createDecisionPacketDraft } from "@/modules/decisions/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await req.json();
    const packet = await createDecisionPacketDraft(session, {
      projectId: id,
      ...body,
    });
    return NextResponse.json(packet, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
