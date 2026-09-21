import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { generateChallengeReport, type ChallengeInput } from "@/modules/advisor/challenge";
import { normalizeScientificEvidence } from "@/modules/research/scientific-evidence";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UnprocessableEntityError("请求体必须是 JSON 对象");
    }
    if (typeof body.productName !== "string" || !body.productName.trim()) {
      throw new UnprocessableEntityError("productName 必填且必须是非空字符串");
    }
    if (typeof body.proposedClaim !== "string" || !body.proposedClaim.trim()) {
      throw new UnprocessableEntityError("proposedClaim 必填且必须是非空字符串");
    }
    if (!Array.isArray(body.ingredients)) {
      throw new UnprocessableEntityError("ingredients 必须是数组");
    }

    const ingredients = body.ingredients.map((ingredient: unknown, index: number) => {
      if (!ingredient || typeof ingredient !== "object" || Array.isArray(ingredient)) {
        throw new UnprocessableEntityError(`ingredients[${index}] 必须是对象`);
      }
      try {
        const normalized = normalizeScientificEvidence(ingredient as any, index);
        if (!normalized) throw new Error("证据卡为空");
        return normalized;
      } catch (error) {
        throw new UnprocessableEntityError(error instanceof Error ? error.message : `ingredients[${index}] 无效`);
      }
    });

    const input: ChallengeInput = {
      productName: body.productName.trim(),
      proposedClaim: body.proposedClaim.trim(),
      targetPrice: body.targetPrice,
      targetDuration: body.targetDuration,
      ingredients,
      advisorVerdict: body.advisorVerdict,
      commercialGaps: body.commercialGaps,
      competitorCount: body.competitorCount,
    };

    const report = generateChallengeReport(input);
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
