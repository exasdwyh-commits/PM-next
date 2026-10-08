import { NextRequest, NextResponse } from "next/server";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { generateActivePush, describeActivePushCron } from "@/modules/assistant-runtime/capabilities/active-push";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || undefined;
    const category = searchParams.get("category") || "health_food";
    const role = searchParams.get("role") || "product";

    // 获取用户记忆
    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId },
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
    const body = await readJsonObjectBody(req);
    const { projectId, category = "health_food", role = "product", trigger = "manual" } = body;

    const memories = await prisma.kernMemory.findMany({
      where: { organizationId: session.organizationId, userId: session.userId },
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

// 描述 cron 配置，供前端展示。
// 需要会话：这是内部调度配置（触发时间/通道），不属于公开信息面。
// 与同目录 GET/POST 保持一致 —— 未登录一律 401，而不是把配置直接吐给匿名调用方。
export async function PUT(req: NextRequest) {
  try {
    await getServerSession(req);
    return NextResponse.json(describeActivePushCron());
  } catch (e) {
    return handleApiError(e, req);
  }
}
