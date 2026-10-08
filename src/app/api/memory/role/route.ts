/**
 * Role Preference Memory API
 * ==========================
 * POST /api/memory/role - 记住角色偏好
 * GET /api/memory/role - 获取角色偏好
 * DELETE /api/memory/role - 清除角色偏好
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { UnprocessableEntityError } from "@/shared/errors";
import { rememberRolePreference, recallRolePreference } from "@/modules/memory/role-preference";
import { listMemories, forgetMemory } from "@/modules/memory";
import type { UserRole } from "@/modules/assistant-runtime/role-intelligence";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const recalled = await recallRolePreference(session);
    return NextResponse.json({ preference: recalled });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = (await req.json()) as { role?: unknown; reason?: unknown };
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

    if (!["leadership", "product", "sales"].includes(role)) {
      throw new UnprocessableEntityError("role must be leadership, product, or sales");
    }

    const saved = await rememberRolePreference(session, role as UserRole, reason);
    return NextResponse.json({ item: saved }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const memories = await listMemories(session, 100);
    const roleMemories = memories.filter(m => 
      m.content.includes("偏好角色") && m.content.includes("用户偏好角色")
    );
    
    let deleted = 0;
    for (const mem of roleMemories) {
      const ok = await forgetMemory(session, mem.id);
      if (ok) deleted++;
    }
    
    return NextResponse.json({ deleted });
  } catch (error) {
    return handleApiError(error, req);
  }
}
