import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { listKernConversations, createKernConversation } from "@/modules/assistant-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await listKernConversations(session));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const convo = await createKernConversation(session, {
      title: body?.title,
      productId: body?.productId ?? null,
    });
    return NextResponse.json(convo, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
