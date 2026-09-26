/** DELETE forgets a memory item; PATCH {pinned} pins/unpins it. Owner-only. */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { forgetMemory, setMemoryPinned } from "@/modules/memory";
import { handleApiError } from "@/shared/api-handler";
import { NotFoundError } from "@/shared/errors";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    if (!(await forgetMemory(session, id))) throw new NotFoundError("Memory not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    const body = (await req.json()) as { pinned?: unknown };
    if (!(await setMemoryPinned(session, id, body.pinned === true))) throw new NotFoundError("Memory not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
