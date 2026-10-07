import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createWorkItem } from "@/modules/work/service";
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
    const item = await createWorkItem(session, id, {
      title: body.title,
      target: body.target,
      deliverableReq: body.deliverableReq,
      executorType: body.executorType,
      dependencies: body.dependencies,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
