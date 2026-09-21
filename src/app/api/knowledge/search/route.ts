import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { searchKnowledge } from "@/modules/knowledge/service";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 8;

    const result = await searchKnowledge(session, { query, limit });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, req);
  }
}
