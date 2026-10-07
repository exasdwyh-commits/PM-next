import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { publishProductVersion } from "@/modules/products/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const body = await readJsonObjectBody(req);
    const version = await publishProductVersion(session, productId, {
      versionTag: body.versionTag,
      specs: body.specs,
      technicalAdvice: body.technicalAdvice,
      experienceGoals: body.experienceGoals,
      targetCost: body.targetCost,
      currency: body.currency,
      unknowns: body.unknowns,
      isConfirmed: body.isConfirmed,
    });
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
