import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { generateDailyBriefing } from "@/modules/assistant-runtime/capabilities/daily-briefing";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || undefined;
    const category = searchParams.get("category") || "health_food";
    const role = searchParams.get("role") || "product";

    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });

    const briefing = await generateDailyBriefing({
      organizationId: session.organizationId,
      userId: session.userId,
      projectId,
      category,
      role,
      memories,
    }, prisma);

    return NextResponse.json({ briefing, memoryCount: memories.length });
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const { projectId, category = "health_food", role = "product" } = body;

    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });

    const briefing = await generateDailyBriefing({
      organizationId: session.organizationId,
      userId: session.userId,
      projectId,
      category,
      role,
      memories,
    }, prisma);

    return NextResponse.json({ briefing, memoryCount: memories.length });
  } catch (e) {
    return handleApiError(e, req);
  }
}
