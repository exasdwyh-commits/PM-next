/**
 * L2 侧的知识域 provider 注册：`memory` 与 `web` 依赖 supervisor / memory 模块（都在 L2），
 * 而 Knowledge Router 在 L3，不能反向 import。所以由 L2 主动注册——
 * 依赖方向保持 L2 → L3，路由本身对这两个域一无所知，只知道有人注册过。
 *
 * 必须在 `routeKnowledge` 之前调用 `ensureAssistantKnowledgeProviders()`；
 * 重复调用幂等（`registerKnowledgeProvider` 本身就是覆盖式注册）。
 */
import type { KnowledgeResultItem } from "@/modules/kern-contracts";
import { registerKnowledgeProvider, authorityFromUri } from "@/modules/knowledge/router";
import { listMemories, selectMemories, relevance } from "@/modules/memory";
import { getWebSearch } from "@/modules/supervisor/web-search";

let done = false;

export function ensureAssistantKnowledgeProviders(): void {
  if (done) return;
  done = true;

  registerKnowledgeProvider({
    scope: "memory",
    label: "长期记忆（这位用户/组织被确认过的偏好与纠正）",
    search: async (ctx) => {
      let memories: Awaited<ReturnType<typeof listMemories>>;
      try {
        memories = await listMemories(ctx.session, 200);
      } catch {
        return [];
      }
      const chosen = selectMemories(memories, ctx.query, ctx.limit);
      return chosen.map<KnowledgeResultItem>((m, idx) => ({
        scope: "memory",
        ref: `memory:${m.id}`,
        title: `记忆（${m.kind}）`,
        snippet: m.content.slice(0, 300),
        uri: null,
        capturedAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
        authorityTier: "first_party",
        // 记忆是本方数据，但**未经本轮核验**：不冒充 verified，交给模型判断是否还适用。
        authority: 0.6,
        score: Math.max(1, Math.round(relevance(ctx.query, m.content) * 10) + (m.pinned ? 4 : 0) - idx),
        verified: false,
        conflictGroup: `memory-kind:${m.kind}`,
        statement: null,
      }));
    },
  });

  registerKnowledgeProvider({
    scope: "web",
    label: "公开网页检索",
    unavailable: () => (getWebSearch() ? null : "未配置网页检索提供方（WebSearch provider 缺失）"),
    search: async (ctx) => {
      const fn = getWebSearch();
      if (!fn) return [];
      const hits = await fn(ctx.query, ctx.limit);
      return hits.map<KnowledgeResultItem>((h, idx) => {
        const { tier } = authorityFromUri(h.url);
        return {
          scope: "web",
          ref: `web:${h.url}`,
          title: h.title || h.url,
          snippet: (h.snippet || "").slice(0, 300),
          uri: h.url,
          capturedAt: null,
          authorityTier: tier,
          authority: tier === "unknown" ? 0.3 : 0.6,
          // 检索引擎的排序本身就是相关度信号，按位次给分。
          score: Math.max(1, (ctx.limit - idx) * 3),
          verified: false,
          conflictGroup: null,
          statement: null,
        };
      });
    },
  });
}

/** 测试用：允许重新注册（provider 表是进程级的）。 */
export function resetAssistantKnowledgeProviders(): void {
  done = false;
}
