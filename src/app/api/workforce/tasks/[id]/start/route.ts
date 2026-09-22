import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { startAgentTask } from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await startAgentTask(session, id));
  } catch (error) {
    return handleApiError(error, req);
  }
}
