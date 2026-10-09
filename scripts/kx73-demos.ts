/**
 * KX-73 三个验收 demo：Capability Resolver → Knowledge Router → Synthesis → Evidence 绑定。
 *
 * 用法：npx tsx scripts/kx73-demos.ts
 *
 * 这是**确定性**的（不调用模型）：Resolver 的四档选择、Router 的选域与不可用原因、
 * Synthesis 的去重/冲突/置信度都是纯逻辑，可以直接把真实输出打出来看。
 * 真实对话里模型会再拿这些产物去组织语言，但「选了哪些能力、去哪找了、冲突是什么」
 * 不由模型说了算。
 */
import { resolveCapabilities } from "../src/modules/assistant-runtime/capabilities/resolver";
import {
  buildCapabilityContextPrompt,
  buildKnowledgeContextPrompt,
  pickCapabilityPromptLevel,
} from "../src/modules/assistant-runtime/context-layers";
import { ensureAssistantKnowledgeProviders } from "../src/modules/assistant-runtime/knowledge-providers";
import { routeKnowledge } from "../src/modules/knowledge/router";
import { synthesizeKnowledge } from "../src/modules/knowledge/synthesis";
import { bindKnowledgeToEvidence } from "../src/modules/knowledge/evidence-bridge";
import { loadAuthorityPolicy } from "../src/modules/knowledge/authority";
import type { SessionContext } from "../src/modules/identity/session";
import prisma from "../src/shared/db";

const DEMOS = [
  { id: 1, text: "分析 PM-next 最近改动判断是否可交付", bind: true },
  { id: 2, text: "评估新 AKK 产品方案是否值得推进", bind: false },
  { id: 3, text: "今天 AI 行业有什么值得关注", bind: false },
];

function line(s = ""): void {
  console.log(s);
}

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { isActive: true, isSystem: false },
    orderBy: { createdAt: "asc" },
  });
  if (!user) {
    line("没有可用用户，无法演示 Knowledge Router（需要真实 session）。");
    return;
  }
  const project = await prisma.project.findFirst({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });
  const session: SessionContext = {
    userId: user.id,
    organizationId: user.organizationId,
    userEmail: user.email,
    userName: user.name,
  };

  ensureAssistantKnowledgeProviders();

  const policy = loadAuthorityPolicy();
  line("=== KX-73 demo ===");
  line(`权威策略：source=${policy.source} tierWeights=${JSON.stringify(policy.tierWeights)} 半衰期=${policy.freshnessHalfLifeDays}天`);
  line(`演示项目：${project ? `${project.title} (${project.id})` : "（无项目，跳过 Evidence 绑定）"}`);
  line();

  for (const demo of DEMOS) {
    line(`──────── demo ${demo.id}：${demo.text} ────────`);

    // 1. 能力解析
    const resolution = resolveCapabilities({ text: demo.text, intent: "UNSUPPORTED", limit: 3 });
    line(`[resolver] source=${resolution.source}  reason=${resolution.reason}`);
    line(`[resolver] nativeCapabilityKey=${resolution.nativeCapabilityKey ?? "null"}`);
    for (const s of resolution.skills) {
      line(`  · ${s.id}  label=${s.label}  priority=${s.priority}  agents=${s.preferredAgents.join(",")}`);
    }
    if (resolution.candidates.length) {
      line(`[resolver] candidates=${resolution.candidates.map((c) => `${c.id}:${c.score}(${c.matchedOn.join("+")})`).join(" | ")}`);
    }
    line(`[resolver] knowledgeScopes=${resolution.knowledgeScopes.join(",") || "（不查知识）"}`);
    line(`[resolver] evidencePolicy=${resolution.evidencePolicy ?? "（无额外要求）"}`);

    // 2. 分层 prompt 档位
    const level = pickCapabilityPromptLevel(resolution.skills.length);
    line(`[prompt] capability 档位=${level}`);
    const capPrompt = buildCapabilityContextPrompt(resolution, level);
    line(`[prompt] capabilityPrompt（前 400 字）：\n${capPrompt.slice(0, 400)}`);

    // 3. 知识路由 + 综合
    const scopes = resolution.knowledgeScopes;
    if (scopes.length === 0) {
      line("[knowledge] 本轮没有声明知识域，不查（不会为了显得勤快而乱查）");
      line();
      continue;
    }
    const route = await routeKnowledge(session, { query: demo.text, scopes, limit: 6 });
    const syn = synthesizeKnowledge(route, { limit: 6 });
    line(`[knowledge] requested=${route.requested.join(",")}`);
    line(`[knowledge] ran=${route.ran.join(",") || "（无）"}  elapsed=${route.elapsedMs}ms`);
    for (const u of route.unavailable) line(`  ! 不可用 ${u.scope}：${u.reason}`);
    line(`[knowledge] 命中 ${route.items.length} 条 → 综合后 top=${syn.top.length}、clusters=${syn.clusters.length}、dropped=${syn.dropped.length}`);
    for (const c of syn.clusters) {
      line(`  ▸ [${c.id}] ${c.title} — ${c.items.length} 条，权威 ${c.authority}，一致度 ${c.agreement}`);
    }
    for (const d of syn.dropped) line(`  ✗ 丢弃 ${d.ref}：${d.reason}`);
    if (syn.conflicts.length === 0) {
      line("[synthesis] 冲突：无");
    } else {
      for (const c of syn.conflicts) {
        line(`[synthesis] 冲突 ${c.group}：${c.statements.length} 种说法，胜出=${c.winnerRef ?? "（打平，交人裁）"}`);
        line(`  reason=${c.reason}`);
        for (const s of c.statements) line(`  · ${s.ref} 权威 ${s.authority}：${s.statement}`);
      }
    }
    line(`[synthesis] 置信度=${syn.confidence}`);
    line(`[knowledge] prompt 摘要（前 500 字）：\n${buildKnowledgeContextPrompt(route, syn).slice(0, 500)}`);

    // 4. Evidence 绑定（只在有项目且 demo 明确要求时）
    if (demo.bind && project) {
      const bound = await bindKnowledgeToEvidence(session, { projectId: project.id, route, syn });
      if (bound.bound) {
        line(`[evidence] bound=true evidenceId=${bound.evidenceId} created=${bound.created} refs=${bound.refs.length} conflicts=${bound.conflictCount}`);
      } else {
        line(`[evidence] bound=false reason=${bound.reason}`);
      }
    } else {
      line("[evidence] 本轮不绑定（没有 projectId，或 demo 未要求）——绑定失败不该挡住对话");
    }
    line();
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
