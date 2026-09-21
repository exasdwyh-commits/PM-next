import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { disposeFeedback } from "@/modules/collaboration/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await req.json();
    const result = await disposeFeedback(session, id, body);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
