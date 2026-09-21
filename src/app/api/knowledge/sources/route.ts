import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { assertOrgAdmin } from "@/modules/identity/admin";
import { createKnowledgeSource, listKnowledgeSources } from "@/modules/knowledge/service";
import { handleApiError } from "@/shared/api-handler";

// 读取知识源明细同样需要管理员：返回体含 rootPath（服务器绝对路径）与最近同步日志，
// 属于配置/技术信息。普通成员在页面上拿到的是脱敏后的计数，不需要也不应拿到这份明细。
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    await assertOrgAdmin(session);
    const sources = await listKnowledgeSources(session);
    return NextResponse.json({ sources });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    await assertOrgAdmin(session);
    const body = await req.json();
    const created = await createKnowledgeSource(session, body);
    return NextResponse.json({ source: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
