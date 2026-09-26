import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  getKernConversation,
  getKernConversationControlState,
  updateKernConversationRuntimeConfig,
} from "@/modules/assistant-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const conversation = await getKernConversation(session, id);
    return NextResponse.json(
      await getKernConversationControlState(session, conversation.runtimeConfig)
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    const config = await updateKernConversationRuntimeConfig(
      session,
      id,
      body?.config
    );
    return NextResponse.json({ config });
  } catch (error) {
    return handleApiError(error, req);
  }
}
