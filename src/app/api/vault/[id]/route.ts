/** DELETE /api/vault/[id] — 撤销凭证并清除密文。仅本人，他人一律 404。 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { revokeCredential } from "@/modules/vault";
import { handleApiError } from "@/shared/api-handler";
import { NotFoundError } from "@/shared/errors";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    if (!(await revokeCredential(session, id))) throw new NotFoundError("Credential not found");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
