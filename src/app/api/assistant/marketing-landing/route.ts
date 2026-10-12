import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { generateMarketingLanding } from "@/modules/assistant-runtime/capabilities/marketing-landing";
import { defaultCategoryKey, tenantSamples } from "@/modules/tenant";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const productName = searchParams.get("productName") || tenantSamples().demoProductName || "示例产品";
    const category = searchParams.get("category") || defaultCategoryKey();
    const target = searchParams.get("target") || "大客户";

    const landing = await generateMarketingLanding({ organizationId: session.organizationId, productName, category, target });
    return NextResponse.json({ landing });
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { productName = tenantSamples().demoProductName || "示例产品", category = defaultCategoryKey(), target = "大客户" } = body;

    const landing = await generateMarketingLanding({ organizationId: session.organizationId, productName, category, target });
    return NextResponse.json({ landing });
  } catch (e) {
    return handleApiError(e, req);
  }
}
