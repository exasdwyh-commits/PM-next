import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { bootstrapDefaultWorkforce } from "@/modules/workforce/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const result = await bootstrapDefaultWorkforce(session);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
