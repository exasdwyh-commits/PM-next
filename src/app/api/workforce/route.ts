import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getWorkforceOverview } from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await getWorkforceOverview(session));
  } catch (error) {
    return handleApiError(error, req);
  }
}
