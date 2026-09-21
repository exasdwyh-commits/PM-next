import { NextResponse } from "next/server";
import prisma from "@/shared/db";

/**
 * 匿名健康探测（最小状态）。
 *
 * 2026-09-15 Phase 3A / T1 / B3 修复：
 *   此前本路由是全仓唯一没有任何鉴权的 API 路由，并且会把数据库名
 *   （`current_database()`）、PostgreSQL 版本，以及数据库抛出的原始
 *   `error.message` 一并回传给匿名调用方。这些都属于内部信息，
 *   匿名请求只该回答「服务是否可用」。
 *
 * 现在：
 *   - 匿名：只回 `{ status: "UP" | "DOWN" }` —— 不含库名、版本、原始错误
 *   - 详情：见 `GET /api/health/details`（需登录），返回库名、版本与探测耗时
 *
 * HTTP 语义：UP → 200，DOWN → 503（让探针可以直接按状态码判断，
 * 不必解析响应体）。
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "UP" });
  } catch {
    // 不把 error.message 回传：匿名调用方拿到的只有「不可用」这一事实。
    return NextResponse.json({ status: "DOWN" }, { status: 503 });
  }
}
