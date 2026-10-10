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
import { LOCAL_TEST_EMAIL, LOCAL_TEST_ORG, LOCAL_TEST_SESSION_DAYS, localTestRequestAllowed, emailForRole } from "@/modules/identity/local-test-policy";

/**
 * 取（或按需创建）局域网测试账号。
 *
 * 为什么要自动创建：局域网免密模式下，用户只需要**选一个角色**就能进，
 * 不该还要先跑脚本建号。每个角色对应一个常驻账号，好处是 session / 审计里
 * 能直接看出是谁以什么视角在用；账号固定也让「选角色」的响应是幂等的。
 *
 * 组织不存在时一并创建——LOCAL_TEST_ORG 只服务这个模式。
 *
 * 注意：`User` 表**没有 role 字段**（role 在 ProjectMember / OrganizationMember 上），
 * 视角角色由客户端 role-context 存储，不入库。
 */
async function ensureLocalTestUser(email: string) {
  const existing = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
  if (existing) return existing;

  const org =
    (await prisma.organization.findUnique({ where: { code: LOCAL_TEST_ORG } })) ??
    // 正常不该走到创建：LOCAL_TEST_ORG 默认指向已有演示数据的组织。
    // 若走到了，说明部署未配 KERN_LOCAL_TEST_ORG_CODE 且该组织不存在 ——
    // 此时建出来的是空组织，登录后任务准备度会全红（见 local-test-policy 的说明）。
    (await prisma.organization.create({ data: { code: LOCAL_TEST_ORG, name: `Kern 测试工作区（${LOCAL_TEST_ORG}）` } }));

  return prisma.user.create({
    data: {
      email,
      name: ROLE_NAMES[email] ?? "局域网测试用户",
      organizationId: org.id,
      // 无口令：局域网免密模式不使用密码登录（正式密码登录走 authenticateUser）。
      passwordHash: null,
    },
    include: { organization: true },
  });
}

const ROLE_NAMES: Record<string, string> = {
  "local-leadership@kern.invalid": "管理者（局域网）",
  "local-product@kern.invalid": "产品经理（局域网）",
  "local-sales@kern.invalid": "运营销售（局域网）",
};

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
    if (body.localTest === true) {
      if (!localTestRequestAllowed(req.headers)) throw new ForbiddenError("Local test login is disabled");
      const email = emailForRole(typeof body.role === "string" ? body.role : null);
      const user = await ensureLocalTestUser(email);
      if (!user.isActive || user.isSystem || user.organization.code !== LOCAL_TEST_ORG) {
        throw new ForbiddenError("Local test account is unavailable");
      }
      return await issueSession(user.id, false, LOCAL_TEST_SESSION_DAYS);
    }
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

async function issueSession(targetUserId: string, isProd: boolean, expiresInDays = 7) {
  const { token, expiresAt } = await createSession(targetUserId, expiresInDays);

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
