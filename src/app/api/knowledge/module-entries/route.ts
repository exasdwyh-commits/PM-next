/**
 * 批次 D：四模块结构化条目的录入与列表。
 *
 * POST 批量录入（同组织内 module+key 重复走 upsert）；GET 按模块过滤列出。
 * 权限口径与知识库其他接口一致：登录后按 organizationId 过滤，跨组织读到空集合。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";
import {
  isKnowledgeModule,
  listModuleEntries,
  MAX_ENTRIES_PER_REQUEST,
  normalizeEntryInput,
  upsertModuleEntries,
} from "@/modules/knowledge/module-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    // 变量名不能用 `module`（Next lint 规则 no-assign-module-variable）
    const raw = searchParams.get("module");
    const moduleFilter = isKnowledgeModule(raw) ? raw : undefined;
    const entries = await listModuleEntries(session.organizationId, moduleFilter);
    return NextResponse.json({ entries, count: entries.length });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const rows = Array.isArray(body.entries) ? body.entries : [body];
    if (!rows.length) {
      return NextResponse.json({ error: "entries 不能为空" }, { status: 400 });
    }
    if (rows.length > MAX_ENTRIES_PER_REQUEST) {
      return NextResponse.json(
        { error: `单次最多录入 ${MAX_ENTRIES_PER_REQUEST} 条` },
        { status: 400 }
      );
    }
    const normalized = rows.map((r: unknown) => normalizeEntryInput(r));
    const entries = await upsertModuleEntries(session.organizationId, session.userId, normalized);
    return NextResponse.json({ entries, count: entries.length }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
