import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getProjectDetail, updateProject } from "@/modules/projects/service";
import { handleApiError } from "@/shared/api-handler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const project = await getProjectDetail(session, id);
    return NextResponse.json(project);
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = await req.json();
    const updated = await updateProject(session, id, body);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, req);
  }
}
