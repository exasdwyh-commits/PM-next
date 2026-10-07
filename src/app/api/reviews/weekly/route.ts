/** GET /api/reviews/weekly — 过去 7 天的复盘与建议（只算不写）；POST 采纳一条建议（只改本人数据）。 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { applyReviewProposal, computeWeeklyReview, parseProposalOp } from "@/modules/supervisor/review-service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const days = Number(req.nextUrl.searchParams.get("days") ?? 7);
    return NextResponse.json(await computeWeeklyReview(session, { days: Number.isFinite(days) && days > 0 && days <= 90 ? days : 7 }));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const op = parseProposalOp(await readJsonObjectBody(req));
    return NextResponse.json(await applyReviewProposal(session, op));
  } catch (error) {
    return handleApiError(error, req);
  }
}
