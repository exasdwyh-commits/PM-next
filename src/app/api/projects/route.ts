import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createProject } from "@/modules/projects/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import prisma from "@/shared/db";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const project = await createProject(session, {
      title: body.title,
      target: body.target,
      mode: body.mode,
      isDemo: body.isDemo,
      decisionMakerId: body.decisionMakerId,
      productVersionId: body.productVersionId,
      constraints: body.constraints,
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const projects = await prisma.project.findMany({
      where: {
        organizationId: session.organizationId,
        members: { some: { userId: session.userId } },
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        decisionMaker: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch (error) {
    return handleApiError(error, req);
  }
}
