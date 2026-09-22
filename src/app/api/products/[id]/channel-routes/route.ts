import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  assessAndSaveProductPotential,
  createChannelRuleProfile,
  evaluateAndSaveChannelRoute,
  listChannelRouteWorkspace,
} from "@/modules/product-development/channel-routes-service";
import { UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    return NextResponse.json(
      await listChannelRouteWorkspace(session, productId)
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id: productId } = await params;
    const body = await readJsonObjectBody(req);
    const action = String(body.action || "");

    if (action === "CREATE_RULE") {
      return NextResponse.json(
        await createChannelRuleProfile(session, body),
        { status: 201 }
      );
    }
    if (action === "EVALUATE_ROUTE") {
      return NextResponse.json(
        await evaluateAndSaveChannelRoute(session, productId, body),
        { status: 201 }
      );
    }
    if (action === "ASSESS_POTENTIAL") {
      return NextResponse.json(
        await assessAndSaveProductPotential(session, productId, body),
        { status: 201 }
      );
    }

    throw new UnprocessableEntityError("未知渠道路线 action");
  } catch (error) {
    return handleApiError(error, req);
  }
}
