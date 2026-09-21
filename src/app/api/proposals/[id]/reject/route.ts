import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { rejectProposal } from "@/modules/advisor/proposals";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

/**
 * 拒绝顾问提议（蓝图 §4.3：采纳与拒绝都要留痕，拒绝必须给理由）。
 * 拒绝不写业务数据，只记录决策与理由。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await readJsonObjectBody(req);

    const result = await rejectProposal(session, id, body?.reason ?? null);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
