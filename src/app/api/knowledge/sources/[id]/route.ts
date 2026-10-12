import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { assertOrgAdmin } from "@/modules/identity/admin";
import { setKnowledgeSourceEnabled } from "@/modules/knowledge/service";
import { UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";

// 启停知识源与「同步」同级：它决定这个源还会不会进检索结果，
// 属于知识库配置面，同样只给组织管理员。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    await assertOrgAdmin(session);
    const { id } = await params;
    const body = await req.json();
    if (typeof body?.enabled !== "boolean") {
      throw new UnprocessableEntityError("enabled 必须是布尔值");
    }
    const source = await setKnowledgeSourceEnabled(session, id, body.enabled);
    return NextResponse.json({ source });
  } catch (error) {
    return handleApiError(error, req);
  }
}