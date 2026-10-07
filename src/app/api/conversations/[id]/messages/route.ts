import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { acceptKernMessage, listKernMessageExecutions, getKernConversation } from "@/modules/assistant-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId } = await params;
    const executions = await listKernMessageExecutions(session, conversationId);
    const conversation = await getKernConversation(session, conversationId);
    return NextResponse.json({
      ...executions,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        citations: message.citations,
      })),
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

/** Kern 对话唯一消息入口。执行、模型、工具与治理都在 Assistant Runtime 后台完成。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId } = await params;
    const body = await readJsonObjectBody(req);
    const result = await acceptKernMessage(session, conversationId, { content: body?.content, clientMessageId: body?.clientMessageId });
    return NextResponse.json(result, { status: result.replayed ? 200 : 202 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
