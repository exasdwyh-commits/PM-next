import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { requestFormalG2Approval } from "@/modules/production/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await requestFormalG2Approval(session, id));
  } catch (error) {
    return handleApiError(error, req);
  }
}
