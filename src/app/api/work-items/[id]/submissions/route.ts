import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { submitWork } from "@/modules/work/service";
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
    const result = await submitWork(session, id, {
      inputRevision: body.inputRevision,
      runMode: body.runMode,
      status: body.status,
      errorMessage: body.errorMessage,
      artifacts: body.artifacts,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
