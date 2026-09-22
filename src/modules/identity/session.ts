import { NextRequest } from "next/server";
import { UnauthorizedError, ForbiddenError } from "@/shared/errors";
import prisma from "@/shared/db";
import { Role } from "@prisma/client";
import crypto from "crypto";

export interface SessionContext {
  userId: string;
  organizationId: string;
  userEmail: string;
  userName: string;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// 口令哈希（B01-01）：Node 内置 scrypt（OpenSSL 实现），格式 algo$N$r$p$salt$hash。
// 不自研密码算法；不使用可逆加密；校验用 timingSafeEqual 防时序侧信道。
// ---------------------------------------------------------------------------
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expectedHex] = parts;
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: Number(n), r: Number(r), p: Number(p) });
  } catch {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// 简单的登录失败节流：同一 email 连续失败 5 次锁定 60 秒（内存态，重启即清）。
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 60_000;
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function assertLoginNotLocked(email: string) {
  const record = loginFailures.get(email.toLowerCase());
  if (record && record.lockedUntil > Date.now()) {
    const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    throw new ForbiddenError(`Too many failed login attempts; retry in ${seconds}s`);
  }
}

function recordLoginFailure(email: string) {
  const key = email.toLowerCase();
  const record = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= LOGIN_MAX_FAILURES) {
    record.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    record.count = 0;
  }
  loginFailures.set(key, record);
}

function clearLoginFailures(email: string) {
  loginFailures.delete(email.toLowerCase());
}

/**
 * 正式登录（B01-01）：仅凭 email + 密码签发会话。
 * 账号由管理员通过 scripts/create-user.ts 创建，不存在公共注册。
 * 无论邮箱是否存在，失败一律返回同一个通用错误，不泄露账号存在性。
 */
export async function authenticateUser(email: string, password: string): Promise<{ userId: string }> {
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || password === "") {
    throw new UnauthorizedError("Invalid credentials");
  }
  assertLoginNotLocked(email);

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok =
    !!user &&
    user.isActive &&
    !user.isSystem &&
    verifyPassword(password, user.passwordHash);
  if (!ok) {
    recordLoginFailure(email);
    throw new UnauthorizedError("Invalid credentials");
  }
  clearLoginFailures(email);
  return { userId: user!.id };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, expiresInDays: number = 7): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError("User not found or inactive");
  }
  if (user.isSystem) {
    throw new ForbiddenError("System principals cannot create interactive sessions");
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return { token: rawToken, expiresAt, sessionId: session.id };
}

export async function revokeSession(rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.session.findUnique({ where: { tokenHash } });
  if (!existing) return false;

  await prisma.session.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  return true;
}

export async function getServerSession(req: NextRequest): Promise<SessionContext> {
  const isProd = process.env.NODE_ENV === "production";
  const devMockAllowed = process.env.DEV_MOCK_AUTH === "true" && !isProd;

  // Production check: Fatal error if mock auth is accidentally configured in production
  if (isProd && process.env.DEV_MOCK_AUTH === "true") {
    throw new ForbiddenError("FATAL_SECURITY_MISCONFIG: DEV_MOCK_AUTH cannot be enabled in production environment");
  }

  // 1. Check Header-based Mock Auth (Strictly forbidden in production)
  const headerUserId = req.headers.get("x-user-id");
  const headerOrgId = req.headers.get("x-organization-id");

  if (headerUserId) {
    if (!devMockAllowed) {
      throw new ForbiddenError("Dev mock auth headers are strictly forbidden in production");
    }

    const user = await prisma.user.findUnique({
      where: { id: headerUserId },
    });

    if (!user || !user.isActive || user.isSystem) {
      throw new UnauthorizedError("User does not exist or is inactive");
    }

    if (headerOrgId && user.organizationId !== headerOrgId) {
      throw new ForbiddenError("Organization context mismatch");
    }

    return {
      userId: user.id,
      organizationId: user.organizationId,
      userEmail: user.email,
      userName: user.name,
    };
  }

  // 2. Cryptographic Server-Side Session Token Verification (from Cookie or Bearer header)
  let rawToken = req.cookies.get("hermes_session_token")?.value;
  const authHeader = req.headers.get("authorization");
  if (!rawToken && authHeader?.startsWith("Bearer ")) {
    rawToken = authHeader.slice(7).trim();
  }

  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    const dbSession = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!dbSession) {
      throw new UnauthorizedError("Invalid session token");
    }

    if (dbSession.revokedAt) {
      throw new UnauthorizedError("Session has been revoked");
    }

    if (dbSession.expiresAt < new Date()) {
      throw new UnauthorizedError("Session has expired");
    }

    if (!dbSession.user.isActive || dbSession.user.isSystem) {
      throw new UnauthorizedError("User account is unavailable for interactive login");
    }

    return {
      userId: dbSession.user.id,
      organizationId: dbSession.user.organizationId,
      userEmail: dbSession.user.email,
      userName: dbSession.user.name,
      sessionId: dbSession.id,
    };
  }

  // 3. 无凭证：一律拒绝（B01-01 移除旧的「匿名回退到首个活跃用户」逻辑，
  //    该回退让所有 API 在未登录时形同免登录，是最大的越权隐患）
  throw new UnauthorizedError("Authentication required. Please log in.");
}

export async function getServerSessionFromContext(
  headerList: { get: (name: string) => string | null | undefined },
  cookieStore: { get: (name: string) => { value: string } | undefined }
): Promise<SessionContext> {
  const isProd = process.env.NODE_ENV === "production";
  const devMockAllowed = process.env.DEV_MOCK_AUTH === "true" && !isProd;

  if (isProd && process.env.DEV_MOCK_AUTH === "true") {
    throw new ForbiddenError("FATAL_SECURITY_MISCONFIG: DEV_MOCK_AUTH cannot be enabled in production");
  }

  const headerUserId = headerList.get("x-user-id");
  const headerOrgId = headerList.get("x-organization-id");

  if (headerUserId) {
    if (!devMockAllowed) {
      throw new ForbiddenError("Dev mock auth headers are strictly forbidden in production");
    }
    const user = await prisma.user.findUnique({ where: { id: headerUserId } });
    if (!user || !user.isActive || user.isSystem) {
      throw new UnauthorizedError("User inactive or not found");
    }
    if (headerOrgId && user.organizationId !== headerOrgId) throw new ForbiddenError("Org mismatch");
    return {
      userId: user.id,
      organizationId: user.organizationId,
      userEmail: user.email,
      userName: user.name,
    };
  }

  const rawToken = cookieStore.get("hermes_session_token")?.value;
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    const dbSession = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      dbSession &&
      !dbSession.revokedAt &&
      dbSession.expiresAt > new Date() &&
      dbSession.user.isActive &&
      !dbSession.user.isSystem
    ) {
      return {
        userId: dbSession.user.id,
        organizationId: dbSession.user.organizationId,
        userEmail: dbSession.user.email,
        userName: dbSession.user.name,
        sessionId: dbSession.id,
      };
    }
  }

  // 无凭证：一律拒绝（与 getServerSession 同口径，不再匿名回退）
  throw new UnauthorizedError("Authentication required. Please log in.");
}

export async function requireProjectRole(
  session: SessionContext,
  projectId: string,
  allowedRoles: Role[]
) {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: session.userId,
      },
    },
    include: {
      project: true,
    },
  });

  if (!member) {
    throw new ForbiddenError("You are not a member of this project");
  }

  if (member.project.organizationId !== session.organizationId) {
    throw new ForbiddenError("Cross-organization access forbidden");
  }

  if (!allowedRoles.includes(member.role)) {
    throw new ForbiddenError(`Action not permitted for role ${member.role}`);
  }

  return { member, project: member.project };
}
