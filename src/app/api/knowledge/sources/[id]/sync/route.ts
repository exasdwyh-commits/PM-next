import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { assertOrgAdmin } from "@/modules/identity/admin";
import { syncKnowledgeSource } from "@/modules/knowledge/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    await assertOrgAdmin(session);
    const { id } = await params;
    const result = await syncKnowledgeSource(session, id);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return handleApiError(error, req);
  }
}
