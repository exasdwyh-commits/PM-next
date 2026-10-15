import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { assertConversationAttachmentAccess, readConversationAttachment, removeConversationAttachment, setConversationAttachmentSearch } from "@/modules/assistant-runtime/attachments";
import { UnprocessableEntityError } from "@/shared/errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id, attachmentId } = await params;
    const file = await readConversationAttachment(session, id, attachmentId);
    return new NextResponse(new Uint8Array(file.bytes), { headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, "%27")}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return handleApiError(error, req); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id, attachmentId } = await params;
    await assertConversationAttachmentAccess(session, id);
    const body = await req.json();
    if (!body || typeof body.indexForSearch !== "boolean") throw new UnprocessableEntityError("检索设置必须是布尔值");
    return NextResponse.json(await setConversationAttachmentSearch(session, id, attachmentId, body.indexForSearch));
  } catch (error) { return handleApiError(error, req); }
}

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
