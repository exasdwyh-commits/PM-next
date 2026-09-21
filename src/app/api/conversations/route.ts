import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { listConversations, createConversation } from "@/modules/advisor/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await listConversations(session));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const convo = await createConversation(session, {
      title: body?.title,
      productId: body?.productId ?? null,
    });
    return NextResponse.json(convo, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
