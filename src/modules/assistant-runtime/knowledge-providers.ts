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
import { listSignalItems } from "@/modules/signal/signal-collection";

let done = false;

export function ensureAssistantKnowledgeProviders(): void {
  if (done) return;
  done = true;

  // C5-B3：社交/竞品信号域与 memory/web 同批注册（依赖方向 L2 → L3 不变）。
  registerSignalKnowledgeProvider();

  registerKnowledgeProvider({
    scope: "memory",
    label: "长期记忆（这位用户/组织被确认过的偏好与纠正）",
    search: async (ctx) => {
      let memories: Awaited<ReturnType<typeof listMemories>>;
      try {
        // C5-A1：记忆 DB 查询无 signal 支持；前后检查，调用方另有竞速兜底。
        ctx.signal.throwIfAborted();
        memories = await listMemories(ctx.session, 200);
        ctx.signal.throwIfAborted();
      } catch {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error("aborted");
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
      // C5-A1：WebSearchFn 本就支持 signal —— 把路由的取消信号透传进去，
      // 超时/上游取消时在途的 HTTP 检索被真实取消。
      const hits = await fn(ctx.query, ctx.limit, ctx.signal);
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

/**
 * C5-B3：社交/竞品信号域。读信号雷达已采集的 SignalItem（按组织隔离），
 * 按查询词做轻量匹配 —— 深搜/更深档的研究路由会带上这个域。
 * 信号 verifyStatus 恒 UNVERIFIED，这里如实标 verified=false。
 */
function signalKeywords(query: string): string[] {
  const cleaned = query.replace(/[?？!！,，。;；:：\[\]\(\)\{\}"'“”‘’]/g, " ").trim();
  const terms = new Set<string>();
  for (const t of cleaned.split(/\s+/).filter(Boolean)) {
    if (t.length >= 2) terms.add(t.toLowerCase());
    if (/[一-龥]/.test(t) && t.length >= 4) {
      for (let i = 0; i + 2 <= t.length; i += 2) terms.add(t.slice(i, i + 2));
    }
  }
  return [...terms];
}

export function registerSignalKnowledgeProvider(): void {
  registerKnowledgeProvider({
    scope: "signal",
    label: "社交/竞品信号（信号雷达已采集条目，未核验）",
    search: async (ctx) => {
      ctx.signal.throwIfAborted();
      let rows: Awaited<ReturnType<typeof listSignalItems>>;
      try {
        rows = await listSignalItems({ organizationId: ctx.session.organizationId, limit: 100 });
      } catch {
        return [];
      }
      ctx.signal.throwIfAborted();
      const kws = signalKeywords(ctx.query);
      if (!kws.length) return [];
      const out: KnowledgeResultItem[] = [];
      for (const row of rows) {
        const text = `${row.title} ${row.summary ?? ""}`.toLowerCase();
        let hits = 0;
        for (const kw of kws) if (text.includes(kw)) hits += 1;
        if (hits === 0) continue;
        out.push({
          scope: "signal",
          ref: `signal:${row.id}`,
          title: row.title,
          snippet: (row.summary ?? row.title).slice(0, 300),
          uri: row.url,
          capturedAt: row.collectedAt instanceof Date ? row.collectedAt.toISOString() : String(row.collectedAt),
          authorityTier: "public",
          authority: 0.4,
          score: Math.min(10, hits * 2),
          verified: false,
          conflictGroup: null,
          statement: null,
        });
      }
      return out.slice(0, ctx.limit);
    },
  });
}
