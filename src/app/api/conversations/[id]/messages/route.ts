import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { sendDepartmentAssistantMessage } from "@/modules/assistant-runtime";
import { getConversation } from "@/modules/advisor/service";
import { handleApiError } from "@/shared/api-handler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId } = await params;
    const conversation = await getConversation(session, conversationId);
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

/**
 * 顾问对话（蓝图 §5.3）：写入链全程留痕（AgentRun + ToolCall），
 * 未接入模型时回复由确定性白名单工具产出，并在回复正文中明确标注。
 *
 * 若本轮产出了待确认提议（如「把目标人群改成…」），响应里会带 `proposal`，
 * 供前端渲染提议卡片。**提议不是执行** —— 确认后才写入业务数据。
 */
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
        message: { id: result.message.id, role: result.message.role, content: result.message.content },
        proposal: result.proposal ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
