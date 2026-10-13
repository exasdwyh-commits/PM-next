import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnsupportedMediaTypeError, UnprocessableEntityError } from "@/shared/errors";
import {
  MAX_FILES_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  assertConversationAttachmentAccess,
  listConversationAttachments,
  supportedFormats,
  uploadConversationAttachments,
} from "@/modules/assistant-runtime/attachments";

/** 列出本会话已上传的材料（含解析状态），供输入框上方的附件条与各端复用。 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId } = await params;
    const attachments = await listConversationAttachments(session, conversationId);
    return NextResponse.json({ attachments, limits: supportedFormats() });
  } catch (error) {
    return handleApiError(error, req);
  }
}

/**
 * 上传并在当次请求内完成解析。
 *
 * 返回 207（Multi-Status）而不是「有失败就整体失败」：一批文件里有一个不支持，
 * 其余若干个已经读过并且在界面上可用了，把它们一起回滚既浪费用户的等待，
 * 也让用户搞不清到底哪份出了问题。逐份给结果，由前端逐个呈现。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: conversationId } = await params;

    // 与既有附件接口同一口径：Content-Type 不是 multipart 时被 req.formData() 抛出的
    // 原生 TypeError 会一路冒成 500，那是调用方编码用错，不是服务端故障，按 415 回绝。
    // 归属先于一切：包括「读请求体」在内。
    // 否则非本人的会话会因为 content-type 不是 multipart 拿到 415，
    // 越权探测被伪装成编码错误，且 multipart 解析白白跑在没权限的请求上。
    await assertConversationAttachmentAccess(session, conversationId);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new UnsupportedMediaTypeError(
        "附件上传需使用 multipart/form-data（字段：files，可选 indexForSearch）"
      );
    }

    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) throw new UnprocessableEntityError("没有收到文件（字段：files）");
    if (files.length > MAX_FILES_PER_MESSAGE) {
      throw new UnprocessableEntityError(
        `单次最多上传 ${MAX_FILES_PER_MESSAGE} 个文件，本次收到 ${files.length} 个`
      );
    }
    const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      throw new UnprocessableEntityError(
        `${oversized.name} 超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 上限`
      );
    }

    const indexForSearch = form.get("indexForSearch") === "true";
    const { uploads } = await uploadConversationAttachments(session, conversationId, files, {
      indexForSearch,
    });

    const failed = uploads.filter((u) => !u.ok).length;
    return NextResponse.json(
      { uploads, limits: supportedFormats() },
      { status: failed === uploads.length ? 422 : 207 }
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
