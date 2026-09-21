import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/shared/db";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";

/**
 * 健康详情（需登录）。
 *
 * 2026-09-15 Phase 3A / T1 / B3：从原 `GET /api/health` 拆出。
 * 库名与 PostgreSQL 版本属于内部信息，不应给匿名调用方；
 * 但运维/监控仍需要它们，所以单独放在这里，用「必须已登录」作为门槛
 * （库名与 PG 版本不是组织内业务数据，故不要求管理员角色；
 *  且当前 `isOrgAdmin` 的语义是「知识库管理员」，用在这里名不副实）。
 *
 * 失败时**不**回传数据库抛出的原始 `error.message`（可能含连接串、主机名、端口），
 * 只给稳定的原因码 + requestId，细节留在服务端日志里。
 */
export async function GET(req: NextRequest) {
  // 未登录 → getServerSession 抛 UnauthorizedError(401)，交由统一处理器输出
  try {
    await getServerSession(req);
  } catch (error) {
    return handleApiError(error, req);
  }

  const startedAt = Date.now();
  try {
    const raw = await prisma.$queryRaw<Array<{ current_database: string; version: string }>>`
      SELECT current_database(), version();
    `;
    const parts = raw[0].version.split(" ");
    return NextResponse.json({
      status: "UP",
      database: raw[0].current_database,
      version: `${parts[0]} ${parts[1] ?? ""}`.trim(),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error(`[health/details ${requestId}] database probe failed:`, error);
    return NextResponse.json(
      { status: "DOWN", reason: "DATABASE_UNREACHABLE", requestId },
      { status: 503 }
    );
  }
}
