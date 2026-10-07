/**
 * GET  /api/vault — 当前用户保管的凭证（只有 header 名 + 末 4 位，永不返回明文或密文）。
 * POST /api/vault — 录入凭证 { target, label?, headers: [{name, value}], ttlSeconds?, oneTime? }。
 * 录入走专门表单，不经过聊天，也不进入模型上下文（KX-30）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createCredential, listCredentials, type HeaderPair } from "@/modules/vault";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json({ items: await listCredentials(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const item = await createCredential(session, {
      target: typeof body.target === "string" ? body.target : "",
      label: typeof body.label === "string" ? body.label : undefined,
      headers: Array.isArray(body.headers) ? (body.headers as HeaderPair[]) : [],
      ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : null,
      oneTime: body.oneTime === true,
    });
    return NextResponse.json({ item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, req);
  }
}
