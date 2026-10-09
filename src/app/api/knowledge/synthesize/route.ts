/**
 * POST /api/knowledge/synthesize — Knowledge Router + Synthesis（可选写 Evidence）。
 *
 * body: { query, scopes?: string[], limit?: number, projectId?: string, bindEvidence?: boolean }
 * 返回：{ route, syn, evidence }
 *
 * - `route` 是原始命中（按域分组，含没查的域与原因）；
 * - `syn` 是去重 / 聚类 / 冲突 / 置信度之后的产物，这才是该拿去用的；
 * - `evidence` 只有在给了 `projectId` 且调用方有证据写入权限、
 *   且（能力包声明了证据要求或存在冲突）时才会真的写；否则带 `bound:false` 说明原因。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { routeKnowledge } from "@/modules/knowledge/router";
import { synthesizeKnowledge } from "@/modules/knowledge/synthesis";
import { bindKnowledgeToEvidence } from "@/modules/knowledge/evidence-bridge";
import { ensureAssistantKnowledgeProviders } from "@/modules/assistant-runtime/knowledge-providers";

interface Body {
  query?: unknown;
  scopes?: unknown;
  limit?: unknown;
  projectId?: unknown;
  bindEvidence?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const raw = (await req.json().catch(() => ({}))) as Body;

    const query = typeof raw.query === "string" ? raw.query.trim().slice(0, 2000) : "";
    const scopes = Array.isArray(raw.scopes)
      ? raw.scopes.filter((s): s is string => typeof s === "string").slice(0, 10)
      : undefined;
    const limit = typeof raw.limit === "number" && raw.limit > 0 ? Math.min(raw.limit, 20) : 6;
    const projectId = typeof raw.projectId === "string" && raw.projectId ? raw.projectId : null;
    const bindEvidence = raw.bindEvidence !== false;

    ensureAssistantKnowledgeProviders();
    const route = await routeKnowledge(session, { query, scopes, limit });
    const syn = synthesizeKnowledge(route, { limit });

    let evidence: unknown = { bound: false, reason: "未请求绑定（没有 projectId）" };
    if (projectId && bindEvidence) {
      evidence = await bindKnowledgeToEvidence(session, { projectId, route, syn });
    }

    return NextResponse.json({ route, syn, evidence });
  } catch (error) {
    return handleApiError(error, req);
  }
}
