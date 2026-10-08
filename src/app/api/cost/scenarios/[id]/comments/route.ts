import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const scenarioId = id;
    const comments = await prisma.costScenarioComment.findMany({
      where: { scenarioId, organizationId: session.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ comments });
  } catch (e) {
    console.error("GET comments error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const scenarioId = id;
    const body = await req.json();
    const { content, mentions = [] } = body;
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });

    // Verify scenario belongs to org
    const scenario = await prisma.costScenario.findFirst({
      where: { id: scenarioId, organizationId: session.organizationId },
    });
    if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });

    const comment = await prisma.costScenarioComment.create({
      data: {
        scenarioId,
        organizationId: session.organizationId,
        userId: session.userId,
        content,
        mentions,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Extract @ mentions and create notifications (future)
    return NextResponse.json({ comment });
  } catch (e) {
    console.error("POST comments error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
