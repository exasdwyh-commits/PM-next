import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getArtifactVersion } from "@/modules/artifacts/service";
import { handleApiError } from "@/shared/api-handler";

/** 某一版本的 HTML 内容（JSON）。前端只在 sandbox iframe 中渲染，不注入主应用 DOM。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; version: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id, version } = await params;
    return NextResponse.json(await getArtifactVersion(session, id, Number(version)), { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
