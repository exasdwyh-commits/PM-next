/**
 * PATCH  /api/connectors/[id] — { tool, enabled } 开关某个工具；{ access: "off"|"read"|"interact" } 整体切换权限档位（KX-61）；
 *                              { refresh: true } 重新列出工具。
 * DELETE /api/connectors/[id] — 移除连接器。仅本人，他人一律 404。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { isConnectorAccess, refreshConnector, removeConnector, setConnectorAccess, setConnectorTool } from "@/modules/connectors";
import { handleApiError } from "@/shared/api-handler";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { readJsonObjectBody } from "@/shared/request-body";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);
    if (body.refresh === true) return NextResponse.json({ item: await refreshConnector(session, id) });
    if (body.access !== undefined) {
      if (!isConnectorAccess(body.access)) throw new UnprocessableEntityError("access 只能是 off、read 或 interact");
      return NextResponse.json({ item: await setConnectorAccess(session, id, body.access) });
    }
    if (typeof body.tool !== "string" || typeof body.enabled !== "boolean") {
      throw new UnprocessableEntityError("需要 { tool, enabled }、{ access } 或 { refresh: true }");
    }
    return NextResponse.json({ item: await setConnectorTool(session, id, body.tool, body.enabled) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    if (!(await removeConnector(session, id))) throw new NotFoundError("Connector not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
