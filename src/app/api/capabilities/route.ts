/**
 * GET /api/capabilities[?q=关键词] — 统一能力目录（KX-71）。
 * 只列当前用户自己能看到的东西（连接器、做法按用户；知识库按组织），跨租户不可见。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { loadCapabilityDirectory } from "@/modules/assistant-runtime/capabilities/directory-loader";
import { searchCapabilities } from "@/modules/assistant-runtime/capabilities/directory";
import { handleApiError } from "@/shared/api-handler";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const directory = await loadCapabilityDirectory(session);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
    const items = q ? searchCapabilities(directory.items, q, 20) : directory.items;
    return NextResponse.json({ items, counts: directory.counts, generatedAt: directory.generatedAt, query: q || null });
  } catch (error) {
    return handleApiError(error, req);
  }
}
