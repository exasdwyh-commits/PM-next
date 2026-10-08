import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getSession } from "@/modules/identity/session";
import { generateDailyBriefing } from "@/modules/assistant-runtime/capabilities/daily-briefing";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || undefined;
    const category = searchParams.get("category") || "health_food";
    const role = searchParams.get("role") || "product";

    const briefing = await generateDailyBriefing({
      organizationId: session.organizationId,
      userId: session.userId,
      projectId,
      category,
      role,
    }, prisma);

    return NextResponse.json({ briefing });
  } catch (e) {
    console.error("GET daily-briefing error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { projectId, category = "health_food", role = "product" } = body;

    const briefing = await generateDailyBriefing({
      organizationId: session.organizationId,
      userId: session.userId,
      projectId,
      category,
      role,
    }, prisma);

    return NextResponse.json({ briefing });
  } catch (e) {
    console.error("POST daily-briefing error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
