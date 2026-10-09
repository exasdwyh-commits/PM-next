import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { executeNewProductPlaybook, describePlaybook } from "@/modules/product-rnd/playbook";

export async function GET(req: NextRequest) {
  try {
    // 只读能力描述，但仍须登录：与同文件 POST 口径一致
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

    if (!productIdea) throw new UnprocessableEntityError("缺少 productIdea");

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
