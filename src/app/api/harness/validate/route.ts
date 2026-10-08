import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { runHarnessValidation } from "@/modules/cost-engine/harness/r1-r17-validation";

/**
 * Harness R1–R17 校验入口（本地补齐）。
 *
 * 鉴权：两个方法都要求会话。
 * 此前 GET/POST 都没有任何会话校验 —— 修好之前这是「无鉴权即暴露」的执行入口，
 * 会被 tests/authz-route-coverage.test.ts 的 AC4（匿名不得拿到 2xx）标红。
 * 它虽然不读库（纯内存校验），但仍是可被匿名触发的计算面，且不属于公开信息面，
 * 因此与其余路由统一口径：未登录 401。
 */
export async function POST(req: NextRequest) {
  try {
    await getServerSession(req);
    const body = await req.json();
    const { category = "health_food", role = "product", htmlReport, richReport, costData, evidenceCount, verifiedCount } = body;
    const result = runHarnessValidation({ category, role, htmlReport, richReport, costData, evidenceCount, verifiedCount });
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    const result = runHarnessValidation({ category: "health_food", role: "product", evidenceCount: 10, verifiedCount: 7 });
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}
