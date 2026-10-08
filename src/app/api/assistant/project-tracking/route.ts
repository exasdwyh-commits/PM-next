import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { generateProjectTracking } from "@/modules/assistant-runtime/capabilities/project-tracking";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const category = searchParams.get("category") || "health_food";
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const tracking = await generateProjectTracking({ organizationId: session.organizationId, projectId, category }, prisma);
    return NextResponse.json({ tracking });
  } catch (e) {
    console.error("GET project-tracking error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { projectId, category = "health_food" } = body;
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

    const tracking = await generateProjectTracking({ organizationId: session.organizationId, projectId, category }, prisma);
    return NextResponse.json({ tracking });
  } catch (e) {
    console.error("POST project-tracking error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
