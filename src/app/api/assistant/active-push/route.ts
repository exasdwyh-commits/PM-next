import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { generateActivePush, describeActivePushCron } from "@/modules/assistant-runtime/capabilities/active-push";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || undefined;
    const category = searchParams.get("category") || "health_food";
    const role = searchParams.get("role") || "product";

    // 获取用户记忆（C7 二阶段：必须排除已遗忘条目——forget 的效力要传播到
    // 主动推送，用户明确忘掉的内容不得再驱动推送；与 daily-briefing 口径一致）
    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });

    const result = await generateActivePush(
      {
        organizationId: session.organizationId,
        userId: session.userId,
        projectId,
        category,
        role,
        trigger: "manual",
      },
      prisma,
      memories
    );

    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { projectId, category = "health_food", role = "product", trigger = "manual" } = body;

    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId, forgottenAt: null },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });

    const result = await generateActivePush(
      {
        organizationId: session.organizationId,
        userId: session.userId,
        projectId,
        category,
        role,
        trigger,
      },
      prisma,
      memories
    );

    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e, req);
  }
}

// 描述 cron 配置，供前端展示
export async function PUT(req: NextRequest) {
  try {
    // 只读能力描述，但仍须登录：避免把内部调度配置暴露给匿名请求（与同文件 GET/POST 口径一致）
    await getServerSession(req);
    return NextResponse.json(describeActivePushCron());
  } catch (e) {
    return handleApiError(e, req);
  }
}
