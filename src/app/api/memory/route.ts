/** GET /api/memory — what Kern remembers about the current user. POST adds one. */
import { NextRequest, NextResponse } from "next/server";
import { KernMemoryKind } from "@prisma/client";
import { getServerSession } from "@/modules/identity/session";
import { listMemories, rememberForUser } from "@/modules/memory";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ items: await listMemories(session) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = (await req.json()) as { content?: unknown };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw new UnprocessableEntityError("content is required");
    const item = await rememberForUser(session, { kind: KernMemoryKind.PREFERENCE, content, pinned: true });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
