import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getWorkforceStudio } from "@/modules/workforce/studio";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await getWorkforceStudio(session), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
