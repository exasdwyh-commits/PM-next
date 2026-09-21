import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { submitDecisionPacket } from "@/modules/decisions/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const result = await submitDecisionPacket(session, id);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
