import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createWorkItem } from "@/modules/work/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await req.json();
    const item = await createWorkItem(session, id, body);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
