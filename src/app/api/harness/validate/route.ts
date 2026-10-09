import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { runHarnessValidation } from "@/modules/cost-engine/harness/r1-r17-validation";

export async function POST(req: NextRequest) {
  try {
    // 须登录：本接口接受调用方传入的 htmlReport / richReport / costData 做校验，
    // 属可被消耗的计算面，不应开放给匿名请求。
    await getServerSession(req);
    const body = await req.json();
    const { category = "health_food", role = "product", htmlReport, richReport, costData, evidenceCount, verifiedCount } = body;
    const result = runHarnessValidation({ category, role, htmlReport, richReport, costData, evidenceCount, verifiedCount });
    return NextResponse.json(result);
  } catch (e) {
    console.error("harness validate error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // 同上：固定入参的自检请求，也须登录，保持与 POST 一致
    await getServerSession(req);
    const result = runHarnessValidation({ category: "health_food", role: "product", evidenceCount: 10, verifiedCount: 7 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("harness validate error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
