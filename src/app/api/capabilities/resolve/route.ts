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
import { resolveCapabilities } from "@/modules/assistant-runtime/capabilities/resolver";
import { capabilitySkillDiagnostics } from "@/modules/assistant-runtime/capabilities/directory-loader";
import { listKnowledgeProviders, MISSING_PROVIDER_NOTES } from "@/modules/knowledge/router";
import { loadAuthorityPolicy } from "@/modules/knowledge/authority";

export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    const sp = req.nextUrl.searchParams;
    const text = (sp.get("q") ?? "").slice(0, 2000);
    const intent = (sp.get("intent") ?? "UNSUPPORTED").slice(0, 60);
    const packsRaw = (sp.get("packs") ?? "").trim();
    const explicitSkillIds = packsRaw
      ? packsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    const resolution = resolveCapabilities({ text, intent, explicitSkillIds, limit: 5 });
    const level = pickCapabilityPromptLevel(resolution.skills.length);

    return NextResponse.json({
      query: text,
      intent,
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
