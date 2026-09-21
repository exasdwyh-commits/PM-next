import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { publishProductVersion } from "@/modules/products/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const body = await req.json();
    const version = await publishProductVersion(session, productId, body);
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
