import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { removeConversationAttachment } from "@/modules/assistant-runtime/attachments";

/**
 * 撤下一份还没发出去的材料。
 *
 * 已经随消息发出去的附件**不允许删**：那等于把一轮对话已经引用的事实来源抽掉，
 * 会话历史和复述都会失去依据。要清理由前端重新发起、或删整段会话。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId, attachmentId } = await params;
    const result = await removeConversationAttachment(session, conversationId, attachmentId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
