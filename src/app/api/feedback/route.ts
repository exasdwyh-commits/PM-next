import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { submitFeedback, listFeedback, deduplicateMemories, describeFeedback } from "@/modules/feedback";
import { AppError } from "@/shared/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    if (action === "describe") return NextResponse.json(describeFeedback());
    if (action === "dedup") {
      const result = await deduplicateMemories(session.organizationId, session.userId);
      return NextResponse.json(result);
    }
    const feedbacks = await listFeedback(session.organizationId, session.userId, 50);
    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
      orderBy: [{ pinned: "desc" }, { useCount: "desc" }],
      take: 20,
    });
    const samples = await prisma.harnessSample.findMany({
      where: { organizationId: session.organizationId, userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ feedbacks, memories, samples, guard: describeFeedback() });
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { type, content, topics, missionId, messageId, source } = body;
    if (!type) throw new AppError("缺少 type", "MISSING_TYPE_FIELD", 400, { type: ["type 为必填"] });
    const result = await submitFeedback({
      organizationId: session.organizationId,
      userId: session.userId,
      missionId,
      messageId,
      type,
      content,
      topics,
      source,
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { sampleId, actual, outcome } = body;
    if (!sampleId || !actual || !outcome)
      throw new AppError("缺少 sampleId/actual/outcome", "MISSING_REQUIRED_FIELDS", 400, { sampleId: ["sampleId/actual/outcome 均为必填"] });
    const { evaluateHarnessSample } = await import("@/modules/feedback");
    const result = await evaluateHarnessSample(session.organizationId, sampleId, actual, outcome);
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}
