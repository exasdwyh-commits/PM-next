import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { executeNewProductPlaybook, describePlaybook } from "@/modules/product-rnd/playbook";
import { AppError } from "@/shared/errors";

export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    return NextResponse.json(describePlaybook());
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { productIdea, projectId, category = "health_food" } = body;

    if (!productIdea) throw new AppError("缺少 productIdea", "MISSING_PRODUCT_IDEA", 400, { productIdea: ["productIdea 为必填"] });

    const missionId = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result = await executeNewProductPlaybook({
      organizationId: session.organizationId,
      userId: session.userId,
      projectId,
      missionId,
      productIdea,
      category,
      revisionRound: 0,
    });

    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}
