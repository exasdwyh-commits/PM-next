import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { getUsageOverview, describeCostGuard } from "@/modules/model-gateway/cost-guard";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const overview = await getUsageOverview(session.organizationId);
    return NextResponse.json({ ...overview, guard: describeCostGuard() });
  } catch (e) {
    return handleApiError(e, req);
  }
}
