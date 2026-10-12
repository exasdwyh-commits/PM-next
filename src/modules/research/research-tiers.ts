/**
 * C5-B：研究三档（快速 / 深搜 / 更深）。
 *
 * 对照 Grok 的研究深度档位：不是「调一次模型时配不同 prompt」，而是
 * 「检索做几轮、动用哪些源、给多少预算」三件事一起分档。
 *
 * 三档定义（默认预算，均为 env 可覆盖）：
 *   fast   快速：只查内部知识（项目文档/公司事实/记忆/业务库），1 轮。
 *   deep   深搜：内部 + 公开网页 + 社交/竞品信号 + 四个结构化知识模块，2 轮
 *           （第二轮用首轮命中做查询扩展，补覆盖）。
 *   deeper 更深：deep 的全部 + 工作区文件域，3 轮。
 *
 * 预算语义复用 C1（步数 / token / 时长）：
 *   maxSteps   —— 检索轮数上限（每轮 = 一次 routeKnowledge 全域检索）。
 *   maxTokens  —— 产出 token 上限；按 1 token ≈ 4 字符折算，超限时从
 *                  rerankScore 最低的条目开始截断/丢弃（不静默超预算）。
 *   maxTimeMs  —— 整轮硬超时；触发时 abort 在途 provider（C5-A1），返回
 *                  已拿到的部分结果并标记 timedOut，不抛错。
 *
 * 分档计量：每次运行写一条 auditEvent（action=RESEARCH_TIER_RUN，
 * details.tier 区分档位），时延/轮数/调用数/命中数进 details —— 不走
 * ModelRun，避免污染模型调用的成本闸计数（ModelRun 行会被配额统计）。
 * 对话与 Mission 统一调 runResearch 即可分档；默认档位 env 可配。
 * 注意：memory/web/signal 三个 L2 域的 provider 由调用方在外层注册
 * （ensureAssistantKnowledgeProviders，L2 → L3 方向），runResearch 不做；
 * 未注册的域按路由既有语义进 unavailable。
 */
import prisma from "@/shared/db";
import type { SessionContext } from "../identity/session";
import {
  routeKnowledge,
  type RouteKnowledgeParams,
} from "@/modules/knowledge/router";
import { rerankKnowledgeItems } from "@/modules/knowledge/rerank";
import type { KnowledgeResultItem, KnowledgeRouteResult } from "@/modules/kern-contracts";

export type ResearchTier = "fast" | "deep" | "deeper";

export const RESEARCH_TIERS: ResearchTier[] = ["fast", "deep", "deeper"];

export const RESEARCH_TIER_LABELS: Record<ResearchTier, string> = {
  fast: "快速",
  deep: "深搜",
  deeper: "更深",
};

export interface ResearchTierBudget {
  /** 检索轮数上限（每轮 = 一次 routeKnowledge 全域检索）。 */
  maxSteps: number;
  /** 产出 token 上限（按 1 token ≈ 4 字符折算截断）。 */
  maxTokens: number;
  /** 整轮硬超时（ms），触发时 abort 在途 provider 并返回部分结果。 */
  maxTimeMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TIER_ENV_PREFIX: Record<ResearchTier, string> = {
  fast: "KERN_RESEARCH_FAST",
  deep: "KERN_RESEARCH_DEEP",
  deeper: "KERN_RESEARCH_DEEPER",
};

/** 三档默认预算（PR 描述与 README 会同步列明，改动时一起改）。 */
export function researchTierBudget(tier: ResearchTier): ResearchTierBudget {
  const p = TIER_ENV_PREFIX[tier];
  const defaults: Record<ResearchTier, ResearchTierBudget> = {
    fast: { maxSteps: 1, maxTokens: 4_000, maxTimeMs: 30_000 },
    deep: { maxSteps: 2, maxTokens: 16_000, maxTimeMs: 120_000 },
    deeper: { maxSteps: 3, maxTokens: 48_000, maxTimeMs: 300_000 },
  };
  const d = defaults[tier];
  return {
    maxSteps: envInt(`${p}_MAX_STEPS`, d.maxSteps),
    maxTokens: envInt(`${p}_MAX_TOKENS`, d.maxTokens),
    maxTimeMs: envInt(`${p}_MAX_TIME_MS`, d.maxTimeMs),
  };
}

/** 每档动用的知识域。fast 只动内部源；deep 加外部与信号；deeper 再加文件域兜底。 */
export function researchTierScopes(tier: ResearchTier): string[] {
  const internal = ["project", "company-facts", "memory", "db"];
  const external = ["web", "signal", "compliance_redline", "category_framework", "channel_access", "operation_sop"];
  if (tier === "fast") return internal;
  if (tier === "deep") return [...internal, ...external];
  return [...internal, ...external, "files"];
}

export function resolveResearchTier(input?: string | null): ResearchTier {
  const raw = (input ?? process.env.KERN_RESEARCH_TIER_DEFAULT ?? "fast").toLowerCase();
  return (RESEARCH_TIERS as string[]).includes(raw) ? (raw as ResearchTier) : "fast";
}

export interface ResearchUsage {
  tier: ResearchTier;
  elapsedMs: number;
  /** 实际执行的检索轮数。 */
  rounds: number;
  /** provider.search 实际调用次数（域数 × 轮数，去重 unavailable 的域仍计数）。 */
  providerCalls: number;
  /** 合并去重后的命中条数（预算截断后）。 */
  items: number;
  /** 是否触发了 maxTimeMs 熔断（部分结果）。 */
  timedOut: boolean;
  budget: ResearchTierBudget;
}

export interface RunResearchParams {
  query: string;
  tier?: ResearchTier | string | null;
  limit?: number;
  signal?: AbortSignal;
  /**
   * 计量函数（测试注入用）。默认写 auditEvent（action=RESEARCH_TIER_RUN），
   * 失败不抛（计量不挡研究）。
   */
  meter?: (record: ResearchUsage & { organizationId: string; query: string }) => Promise<void>;
}

export interface RunResearchResult {
  tier: ResearchTier;
  /** 多轮合并、去重、重排、预算截断后的路由结果。 */
  route: KnowledgeRouteResult;
  usage: ResearchUsage;
}

async function defaultMeter(
  session: SessionContext,
  query: string,
  usage: ResearchUsage
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "RESEARCH_TIER_RUN",
        objectType: "ResearchTier",
        objectId: `${usage.tier}:${Date.now()}`,
        summary:
          `研究${RESEARCH_TIER_LABELS[usage.tier]}档：${usage.rounds} 轮 / ` +
          `${usage.providerCalls} 次 provider 调用 / ${usage.items} 条命中 / ` +
          `${usage.elapsedMs}ms${usage.timedOut ? "（超时熔断，部分结果）" : ""}`,
        details: {
          tier: usage.tier,
          query: query.slice(0, 200),
          elapsedMs: usage.elapsedMs,
          rounds: usage.rounds,
          providerCalls: usage.providerCalls,
          items: usage.items,
          timedOut: usage.timedOut,
          // Prisma Json 字段要纯对象：budget 显式展开（类型不带索引签名）。
          budget: {
            maxSteps: usage.budget.maxSteps,
            maxTokens: usage.budget.maxTokens,
            maxTimeMs: usage.budget.maxTimeMs,
          },
        },
      },
    });
  } catch {
    // 计量失败不挡研究：audit 写库失败时静默跳过。
  }
}

/** 从上一轮命中里抽查询扩展词：取其 top3 标题里的长词（去重、去停用），补覆盖用。 */
function expandQuery(lastRoundItems: KnowledgeResultItem[], roundQuery: string): string {
  const stop = new Set(["的", "和", "与", "及", "在", "是", "有", "了", "等", "或"]);
  const words = new Set<string>();
  const rq = roundQuery.toLowerCase();
  for (const item of lastRoundItems.slice(0, 3)) {
    for (const t of item.title.replace(/[?？!！,，。;；:：()（）\[\]]/g, " ").split(/\s+/)) {
      const w = t.trim().toLowerCase();
      if (w.length >= 2 && !stop.has(w) && !rq.includes(w)) words.add(w);
      if (words.size >= 6) break;
    }
    if (words.size >= 6) break;
  }
  return words.size ? `${roundQuery} ${[...words].join(" ")}` : roundQuery;
}

/** maxTokens 预算执行：按 1 token ≈ 4 字符折算，总 snippet 字符超限时从低分条目截断。 */
export function applyTokenBudget(
  items: KnowledgeResultItem[],
  maxTokens: number
): KnowledgeResultItem[] {
  const charBudget = maxTokens * 4;
  let used = 0;
  const out: KnowledgeResultItem[] = [];
  // items 已按 rerankScore 降序：高分优先保留。
  for (const item of items) {
    const cost = item.snippet.length + item.title.length;
    if (used + cost > charBudget) break;
    used += cost;
    out.push(item);
  }
  return out;
}

export async function runResearch(
  session: SessionContext,
  params: RunResearchParams
): Promise<RunResearchResult> {
  const started = Date.now();
  const tier = resolveResearchTier(params.tier);
  const budget = researchTierBudget(tier);
  const scopes = researchTierScopes(tier);
  const limit = Math.max(1, params.limit ?? 8);
  const query = (params.query ?? "").trim();

  // L2 的知识域 provider（memory/web/signal）由调用方在外层注册
  // （对话链路：context-layers 的 ensureAssistantKnowledgeProviders；依赖方向
  // L2 → L3，research（L3）不能反向 import L2）。
  // 未注册的域按路由既有语义进 unavailable（缺 provider 要说出来，不静默）。

  // 整轮硬超时：触发即 abort 在途 provider（C5-A1），返回部分结果。
  const runController = new AbortController();
  const onUpstreamAbort = () => runController.abort(params.signal?.reason);
  params.signal?.addEventListener("abort", onUpstreamAbort, { once: true });
  const timer = setTimeout(
    () => runController.abort(new Error(`研究${RESEARCH_TIER_LABELS[tier]}档超过 ${budget.maxTimeMs}ms（熔断，返回部分结果）`)),
    budget.maxTimeMs
  );
  if (typeof timer.unref === "function") timer.unref();

  let timedOut = runController.signal.aborted;
  const merged = new Map<string, KnowledgeResultItem>();
  let providerCalls = 0;
  let rounds = 0;
  const unavailable: KnowledgeRouteResult["unavailable"] = [];
  const ranScopes = new Set<string>();

  try {
    let roundQuery = query;
    for (let round = 1; round <= budget.maxSteps; round++) {
      if (runController.signal.aborted) {
        timedOut = true;
        break;
      }
      rounds = round;
      const routeParams: RouteKnowledgeParams = {
        query: roundQuery,
        scopes,
        limit,
        signal: runController.signal,
        // 多轮之间用扩展查询，缓存键天然不同；同轮内不重复查。
        cache: true,
      };
      let route: KnowledgeRouteResult;
      try {
        route = await routeKnowledge(session, routeParams);
      } catch (error) {
        // 整轮被 abort → 熔断收尾；其他错误记入 unavailable 后继续合并已有结果。
        if (runController.signal.aborted) {
          timedOut = true;
          break;
        }
        unavailable.push({
          scope: `round-${round}`,
          reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        });
        break;
      }
      providerCalls += route.ran.length;
      for (const s of route.ran) ranScopes.add(s);
      for (const u of route.unavailable) {
        if (!unavailable.some((x) => x.scope === u.scope)) unavailable.push(u);
      }
      for (const item of route.items) {
        if (!merged.has(item.ref)) merged.set(item.ref, item);
      }
      // 覆盖足够（命中数达标）或查询扩展无新词 → 不再追加轮次。
      if (merged.size >= limit) break;
      const expanded = expandQuery(route.items, roundQuery);
      if (expanded === roundQuery) break;
      roundQuery = expanded;
    }
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onUpstreamAbort);
  }

  // 熔断判定收口：循环内可能因「扩展无新词」正常 break，但整轮控制器
  // 其实已被 abort（超时/上游取消）—— 此时必须标记 timedOut，不能报成「正常完成」。
  if (runController.signal.aborted) timedOut = true;

  // 跨轮合并后再重排一次（各轮是独立路由的分数），然后执行 token 预算。
  const reranked = rerankKnowledgeItems([...merged.values()]);
  const budgeted = applyTokenBudget(reranked, budget.maxTokens);

  const route: KnowledgeRouteResult = {
    query,
    requested: scopes,
    ran: [...ranScopes].sort(),
    items: budgeted,
    unavailable: unavailable.sort((a, b) => a.scope.localeCompare(b.scope)),
    elapsedMs: Date.now() - started,
  };

  const usage: ResearchUsage = {
    tier,
    elapsedMs: Date.now() - started,
    rounds,
    providerCalls,
    items: budgeted.length,
    timedOut,
    budget,
  };

  const meter = params.meter ?? ((record) => defaultMeter(session, query, record));
  await meter({ ...usage, organizationId: session.organizationId, query });

  return { tier, route, usage };
}
