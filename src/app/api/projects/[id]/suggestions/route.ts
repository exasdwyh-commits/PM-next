import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { assembleProductSuggestionPackage, commitProductSuggestionToGate } from "@/modules/products/product-suggestion";
import { handleApiError } from "@/shared/api-handler";

/**
 * B6：统一走 handleApiError。
 * 此前本文件自写错误分支，500 时直接回传 `err.message` —— 生产环境会泄露
 * Prisma / 内部实现细节；handleApiError 在生产态已收敛为通用文案并附 requestId。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // B01-01: API 路由统一使用 getServerSession，同时支持会话 Cookie 与 Bearer 令牌
    const session = await getServerSession(req);

    const suggestion = await assembleProductSuggestionPackage(session, id);
    return NextResponse.json(suggestion);
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getServerSession(req);

    const idempotencyKey =
      req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key") || undefined;

    const body = await req.json();
    const suggestion = body.suggestion || await assembleProductSuggestionPackage(session, id, body);
    const result = await commitProductSuggestionToGate(session, id, suggestion, {
      budgetScope: body.budgetScope,
      validationPlan: body.validationPlan,
      isConfirmed: body.isConfirmed,
      idempotencyKey: idempotencyKey || body.idempotencyKey,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
