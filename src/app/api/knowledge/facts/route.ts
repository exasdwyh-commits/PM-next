import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { assertOrgAdmin, isOrgAdmin } from "@/modules/identity/admin";
import {
  listCompanyFacts,
  upsertCompanyFact,
  confirmCompanyFact,
  supersedeCompanyFact,
} from "@/modules/knowledge/service";
import { projectCompanyFacts } from "@/modules/knowledge/fact-visibility";
import { handleApiError } from "@/shared/api-handler";

/**
 * 读取公司事实。
 *
 * 权限口径（2026-09-15 Phase 3A / T1 / B1 修复）：
 *   此前这里只取会话，然后把 `listCompanyFacts()` 的整行直接返回 ——
 *   连机器 `key`、来源 `sourcePath` 都会一起给出；而知识页对非管理员是明确
 *   剔除这些字段的。「页面做了收口、接口绕过去」等于没做收口。
 *
 * 现在与页面共用 `projectCompanyFacts()`：
 *   - 组织内任意成员：只拿业务字段（不含 key / category / sourcePath 等内部字段）
 *   - 知识库管理员：额外拿到内部字段（原有能力不变）
 * 两种身份都仍受 `listCompanyFacts()` 的 organizationId 过滤约束，不跨组织。
 *
 * 注：本接口当前没有 UI 调用方（页面走服务端渲染）。若产品要求「事实明细仅管理员可读」，
 * 在下一行补 `await assertOrgAdmin(session);` 即可 —— 那是更严的口径，
 * 但与「页面把事实展示给所有成员」不一致，故本轮选择「按身份脱敏」而非「直接封禁」。
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const isAdmin = await isOrgAdmin(session);
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || undefined;
    const status = (searchParams.get("status") as any) || undefined;

    const facts = await listCompanyFacts(session, { category, status });
    return NextResponse.json({ facts: projectCompanyFacts(facts, isAdmin) });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    await assertOrgAdmin(session);
    const body = await req.json();
    const fact = await upsertCompanyFact(session, body);
    return NextResponse.json({ fact }, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    await assertOrgAdmin(session);
    const body = await req.json();
    const { factId, action, supersededById } = body;

    if (action === "CONFIRM") {
      const fact = await confirmCompanyFact(session, factId);
      return NextResponse.json({ fact });
    } else if (action === "SUPERSEDE") {
      const fact = await supersedeCompanyFact(session, factId, supersededById);
      return NextResponse.json({ fact });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
