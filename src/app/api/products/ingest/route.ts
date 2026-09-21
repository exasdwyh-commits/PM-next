import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createDevelopmentProduct } from "@/modules/products/service";
import { handleApiError } from "@/shared/api-handler";

/**
 * 产品入库（蓝图 §4.2）
 * 首屏仅要求 名称/一句话想法、目标人群与场景、核心卖点、预期渠道；
 * 其余字段选填。保存即进入产品总览，不要求先填完整研发评审表。
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const result = await createDevelopmentProduct(session, body);
    return NextResponse.json(
      {
        productId: result.product.id,
        productVersionId: result.version.id,
        projectId: result.project.id,
        identityCode: result.product.identityCode,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
