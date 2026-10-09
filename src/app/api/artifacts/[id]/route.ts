import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getArtifactSummary } from "@/modules/artifacts/service";
import { handleApiError } from "@/shared/api-handler";

/** Kern 成果概要与版本列表：仅会话本人可读，其他账号/组织一律 404。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await getArtifactSummary(session, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
