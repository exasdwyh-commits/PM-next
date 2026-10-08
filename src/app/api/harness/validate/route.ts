import { NextRequest, NextResponse } from "next/server";
import { runHarnessValidation } from "@/modules/cost-engine/harness/r1-r17-validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category = "health_food", role = "product", htmlReport, richReport, costData, evidenceCount, verifiedCount } = body;
    const result = runHarnessValidation({ category, role, htmlReport, richReport, costData, evidenceCount, verifiedCount });
    return NextResponse.json(result);
  } catch (e) {
    console.error("harness validate error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET() {
  const result = runHarnessValidation({ category: "health_food", role: "product", evidenceCount: 10, verifiedCount: 7 });
  return NextResponse.json(result);
}
