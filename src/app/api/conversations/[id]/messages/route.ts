import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { sendDepartmentAssistantMessage, getKernConversation } from "@/modules/assistant-runtime";
import { handleApiError } from "@/shared/api-handler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId } = await params;
    const conversation = await getKernConversation(session, conversationId);
    return NextResponse.json({
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
    const body = await req.json();
    const result = await sendDepartmentAssistantMessage(session, conversationId, body?.content);
    return NextResponse.json(
      {
        runId: result.runId,
        message: {
          id: result.message.id,
          role: result.message.role,
          content: result.message.content,
          createdAt: result.message.createdAt,
          citations: result.message.citations,
        },
        proposal: result.proposal ?? null,
        visualGraph: result.visualGraphShadow ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
