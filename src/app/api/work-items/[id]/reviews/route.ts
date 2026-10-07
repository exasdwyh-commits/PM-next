import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { reviewWork } from "@/modules/work/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    const result = await reviewWork(session, id, { accepted: body.accepted, reason: body.reason });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
