/**
 * GET  /api/connectors — 当前用户接入的连接器（MCP 服务器）与工具开关。
 * POST /api/connectors — 接入 { url, name? }：连接、列出工具、保存快照（读默认启用、写默认停用）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { addConnector, listConnectors } from "@/modules/connectors";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ items: await listConnectors(session) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const item = await addConnector(session, {
      url: typeof body.url === "string" ? body.url : "",
      name: typeof body.name === "string" ? body.name : undefined,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
