/**
 * GET /api/capabilities/resolve?q=…&intent=…&packs=a.b,c.d — Capability Inspector。
 *
 * 回答「面对这句话，Kern 会选哪些能力包、为什么、要不要查知识、证据要求是什么」。
 * 只读：不执行任何能力，不写数据库，因此不改变任何权限边界。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import {
  buildCapabilityContextPrompt,
  pickCapabilityPromptLevel,
} from "@/modules/assistant-runtime/context-layers";
import { resolveConversationCapabilities } from "@/modules/assistant-runtime/capabilities/resolver";
import { routeIntent } from "@/modules/assistant-runtime/router";
import { capabilitySkillDiagnostics } from "@/modules/assistant-runtime/capabilities/directory-loader";
import { listKnowledgeProviders, MISSING_PROVIDER_NOTES } from "@/modules/knowledge/router";
import { loadAuthorityPolicy } from "@/modules/knowledge/authority";

export async function GET(req: NextRequest) {
  try {
    // 组织可见性必须来自登录会话本身，不接受客户端自称——否则预告会漏掉过滤。
    const session = await getServerSession(req);
    const sp = req.nextUrl.searchParams;
    const text = (sp.get("q") ?? "").slice(0, 2000);
    const intentParam = (sp.get("intent") ?? "").trim();
    // 执行侧用的是 kx 路由出的 intent；这里没显式给 intent 时按同一套确定性规则推一遍，
    // 而不是一律 UNSUPPORTED（那会让 INTENT 档永远不参与，预告系统性偏少）。
    const intent = intentParam
      ? intentParam.slice(0, 60)
      : routeIntent(text, sp.get("productBound") === "1");
    const intentSource = intentParam ? "PARAM" : "DETERMINISTIC";
    const packsRaw = (sp.get("packs") ?? "").trim();
    const explicitSkillIds = packsRaw
      ? packsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    // 与对话执行链共用同一入口与同一上限，预告即所见。
    const resolution = resolveConversationCapabilities({
      text,
      intent,
      explicitSkillIds,
      organizationId: session.organizationId,
    });
    const level = pickCapabilityPromptLevel(resolution.skills.length);

    return NextResponse.json({
      query: text,
      intent,
      intentSource,
      resolution,
      promptLevel: level,
      capabilityPrompt: buildCapabilityContextPrompt(resolution, level),
      knowledgeProviders: listKnowledgeProviders(),
      missingKnowledgeProviders: MISSING_PROVIDER_NOTES,
      authorityPolicy: loadAuthorityPolicy(),
      skillDiagnostics: capabilitySkillDiagnostics(),
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
