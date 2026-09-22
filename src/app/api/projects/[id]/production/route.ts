import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getProductionContext } from "@/modules/production/service";
import { handleApiError } from "@/shared/api-handler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    return NextResponse.json(await getProductionContext(session, id));
  } catch (error) {
    return handleApiError(error, req);
  }
}
