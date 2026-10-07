import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getKernConversation, renameKernConversation, archiveKernConversation } from "@/modules/assistant-runtime";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { UnprocessableEntityError } from "@/shared/errors";

/**
 * E2a · 会话管理端点（owner-only）。
 * PATCH body（字段可组合，均可选但至少一个）：
 *   { title?: string, archived?: boolean }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await getKernConversation(session, id));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);

    const title = body?.title;
    const archived = body?.archived;
    if (title === undefined && archived === undefined) {
      throw new UnprocessableEntityError("Nothing to update: provide title and/or archived");
    }
    if (title !== undefined && typeof title !== "string") {
      throw new UnprocessableEntityError("title must be a string");
    }
    if (archived !== undefined && typeof archived !== "boolean") {
      throw new UnprocessableEntityError("archived must be a boolean");
    }

    let conversation;
    if (typeof title === "string") {
      conversation = await renameKernConversation(session, id, title);
    }
    if (typeof archived === "boolean") {
      conversation = await archiveKernConversation(session, id, archived);
    }
    return NextResponse.json(conversation);
  } catch (error) {
    return handleApiError(error, req);
  }
}
