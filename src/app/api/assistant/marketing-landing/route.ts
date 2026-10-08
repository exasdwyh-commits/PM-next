import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { generateMarketingLanding } from "@/modules/assistant-runtime/capabilities/marketing-landing";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const productName = searchParams.get("productName") || "多酚软糖";
    const category = searchParams.get("category") || "health_food";
    const target = searchParams.get("target") || "大客户";

    const landing = await generateMarketingLanding({ organizationId: session.organizationId, productName, category, target });
    return NextResponse.json({ landing });
  } catch (e) {
    console.error("GET marketing-landing error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { productName = "多酚软糖", category = "health_food", target = "大客户" } = body;

    const landing = await generateMarketingLanding({ organizationId: session.organizationId, productName, category, target });
    return NextResponse.json({ landing });
  } catch (e) {
    console.error("POST marketing-landing error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
