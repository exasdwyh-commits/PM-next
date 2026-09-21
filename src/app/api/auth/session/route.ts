import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  createSession,
  revokeSession,
  getServerSession,
} from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import { ForbiddenError, UnauthorizedError, UnprocessableEntityError } from "@/shared/errors";
import prisma from "@/shared/db";

/**
 * B01-01 登录：
 * - 正式路径（所有环境可用）：{ email, password } 密码校验后签发会话；
 * - 开发快捷路径（仅 NODE_ENV=development 且 DEV_MOCK_AUTH=true）：{ email } 免密签发，
 *   生产环境不可用，且生产配置 DEV_MOCK_AUTH=true 直接拒绝启动逻辑（FATAL_SECURITY_MISCONFIG）。
 */
export async function POST(req: NextRequest) {
  try {
    const isProd = process.env.NODE_ENV === "production";
    const devMockAllowed = process.env.DEV_MOCK_AUTH === "true" && !isProd;

    if (isProd && process.env.DEV_MOCK_AUTH === "true") {
      throw new ForbiddenError(
        "FATAL_SECURITY_MISCONFIG: DEV_MOCK_AUTH cannot be enabled in production environment"
      );
    }

    const body = await readJsonObjectBody(req);
    const { email, password, userId } = body as { email?: string; password?: string; userId?: string };

    if (!email || typeof email !== "string") {
      throw new UnprocessableEntityError("Email is required");
    }

    if (typeof password === "string" && password !== "") {
      // 正式登录：密码校验（错误凭证不签发会话）
      const { userId: authenticatedUserId } = await authenticateUser(email, password);
      return await issueSession(authenticatedUserId, isProd);
    }

    if (userId && devMockAllowed) {
      // 开发快捷登录：仅显式传 userId 且明确允许的开发环境
      return await issueSession(userId, isProd);
    }

    throw new UnauthorizedError("Invalid credentials");
  } catch (error) {
    return handleApiError(error, req);
  }
}

async function issueSession(targetUserId: string, isProd: boolean) {
  const { token, expiresAt } = await createSession(targetUserId);

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { email: true, name: true, organizationId: true },
  });

  // B6：响应体**不再回传令牌**，也不回传内部 sessionId。
  // 浏览器只通过下面的 httpOnly Cookie 持有会话。把 token 放进 JSON 会让
  // 脚本可读（XSS 即可窃取），也容易被写进前端日志 / 监控采样。
  const res = NextResponse.json({
    success: true,
    expiresAt: expiresAt.toISOString(),
    user,
  });

  // Set HTTP-only secure cookie
  res.cookies.set("hermes_session_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  return res;
}

export async function DELETE(req: NextRequest) {
  try {
    const authorization = req.headers.get("authorization");
    const rawToken = req.cookies.get("hermes_session_token")?.value ||
      (authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined);
    if (rawToken) {
      await revokeSession(rawToken);
    }
    const res = NextResponse.json({ success: true, message: "Logged out" });
    res.cookies.delete("hermes_session_token");
    return res;
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ session });
  } catch (error) {
    return handleApiError(error, req);
  }
}
