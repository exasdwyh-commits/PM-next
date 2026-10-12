/**
 * 批次 D：条目的删除（软删）。
 *
 * 破坏性操作限**创建者本人**：同组织非创建者 403，跨组织 404（不泄露存在性）。
 * 与成本情景 PUT/DELETE 同口径。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { softDeleteEntry } from "@/modules/knowledge/module-service";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id } = await params;
    await softDeleteEntry(session.organizationId, id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, req);
  }
}
