/**
 * Knowledge Router：按需求（能力包声明的 scope / 用户问题）决定**这一轮去哪找事实**。
 *
 * 关键设计：
 *  - **provider 注册制**。每个知识域是一个 `KnowledgeProvider`，同一接口，谁实现谁注册。
 *    路由层不知道 provider 怎么查，只负责：选域 → 并发执行 → 收集不可用原因 → 汇总。
 *  - **权限在 provider 里**。每个 provider 只拿到 `SessionContext`，自行按 organizationId /
 *    用户可见性过滤。能力包**不能**通过 scope 参数绕开这层——路由不提供任何越权入口。
 *  - **缺 provider 要说出来**。请求了 `github` 但没注册 → 进 `unavailable[]` 并写清该由
 *    哪个模块实现，而不是静默返回空（静默空会让模型以为「查过了，没有」）。
 *  - L2 的知识域（memory / web 依赖 supervisor、memory 模块）通过 `registerKnowledgeProvider`
 *    由上层注册，避免 L3 → L2 的向上依赖。
 *
 * 产出只是**原始命中**；跨源去重、权威排序、冲突识别在 synthesis.ts。
 */
import fs from "node:fs";
import pathModule from "node:path";
import type { KnowledgeResultItem, KnowledgeRouteResult, KnowledgeScope } from "@/modules/kern-contracts";
import type { SessionContext } from "../identity/session";
import prisma from "@/shared/db";
import { classifySourceUrl } from "@/modules/evidence/source-trust";
import { searchKnowledge, type KnowledgeSearchResult } from "./search";
import { authorityScore, trustTierToAuthorityTier, loadAuthorityPolicy } from "./authority";

export interface KnowledgeProviderContext {
  session: SessionContext;
  query: string;
  limit: number;
  /**
   * 同一次路由内 memo 化的知识库检索。
   * `project` 与 `company-facts` 两个域其实来自同一次查询的两半，共用它避免查两遍。
   */
  searchKnowledgeOnce: () => Promise<KnowledgeSearchResult>;
}

export interface KnowledgeProvider {
  /** 与 `KnowledgeScope` 对应的域标识。 */
  scope: KnowledgeScope | string;
  label: string;
  /** 不可用原因；返回非 null 表示这一轮跳过它。 */
  unavailable?: (ctx: KnowledgeProviderContext) => string | null;
  search: (ctx: KnowledgeProviderContext) => Promise<KnowledgeResultItem[]>;
}

const registry = new Map<string, KnowledgeProvider>();

export function registerKnowledgeProvider(provider: KnowledgeProvider): void {
  registry.set(provider.scope, provider);
}

export function unregisterKnowledgeProvider(scope: string): void {
  registry.delete(scope);
}

export function listKnowledgeProviders(): { scope: string; label: string }[] {
  return [...registry.values()].map((p) => ({ scope: p.scope, label: p.label }));
}

export function hasKnowledgeProvider(scope: string): boolean {
  return registry.has(scope);
}

/** 还没实现的 provider 说明（Inspector / 报告用）。 */
export const MISSING_PROVIDER_NOTES: Record<string, string> = {
  github:
    "GitHub provider 未实现。应在 src/modules/connectors/github-source.ts（L4 执行底座）实现，通过 connectors 的凭证调 GitHub API，再注册到本路由；当前回落到 project/files。",
};

// ---------------------------------------------------------------------------
// 通用构造
// ---------------------------------------------------------------------------

function keywords(query: string): string[] {
  const cleaned = query.replace(/[?？!！,，。;；:：\[\]\(\)\{\]"'“”‘’]/g, " ").trim();
  const terms = new Set<string>();
  for (const t of cleaned.split(/\s+/).filter(Boolean)) {
    if (t.length >= 2) terms.add(t.toLowerCase());
    if (/[一-龥]/.test(t) && t.length >= 4) {
      for (let i = 0; i + 2 <= t.length; i += 2) terms.add(t.slice(i, i + 2));
    }
  }
  return [...terms];
}

function snippetAround(text: string, kws: string[], maxLen = 160): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  let pos = -1;
  for (const kw of kws) {
    pos = lower.indexOf(kw);
    if (pos >= 0) break;
  }
  const start = pos >= 0 ? Math.max(0, pos - 40) : 0;
  const slice = text.slice(start, start + maxLen);
  return (start > 0 ? "..." : "") + slice + (start + maxLen < text.length ? "..." : "");
}

function relevanceScore(text: string, title: string, kws: string[]): number {
  const t = text.toLowerCase();
  const h = title.toLowerCase();
  let raw = 0;
  for (const kw of kws) {
    if (h.includes(kw)) raw += 10;
    const count = t.split(kw).length - 1;
    raw += Math.min(count * 2, 8);
  }
  return raw;
}

function makeItem(
  partial: Pick<KnowledgeResultItem, "scope" | "ref" | "title" | "snippet" | "uri"> &
    Partial<Omit<KnowledgeResultItem, "scope" | "ref" | "title" | "snippet" | "uri" | "authority" | "authorityTier">> & {
      authorityTier?: KnowledgeResultItem["authorityTier"];
    },
  policy = loadAuthorityPolicy()
): KnowledgeResultItem {
  const tier = partial.authorityTier ?? "unknown";
  const verified = partial.verified ?? false;
  return {
    capturedAt: null,
    score: 0,
    verified,
    conflictGroup: null,
    statement: null,
    ...partial,
    authorityTier: tier,
    authority: authorityScore(tier, verified, policy),
  };
}

/** 权威档从「URL 可分类」推导；能分类就不用 unknown。给 web/github 这类外链 provider 复用。 */
export function authorityFromUri(uri: string | null) {
  if (!uri) return { tier: "unknown" as const, organizationId: null };
  const c = classifySourceUrl(uri);
  return { tier: trustTierToAuthorityTier(c.trustTier), organizationId: c.organizationId };
}

// ---------------------------------------------------------------------------
// 内置 provider（L3 领域层能直接实现的部分）
// ---------------------------------------------------------------------------

registerKnowledgeProvider({
  scope: "project",
  label: "项目与公司知识库（已同步文档切片）",
  search: async (ctx) => {
    const r = await ctx.searchKnowledgeOnce();
    const kws = keywords(ctx.query);
    return r.citations.map((c) =>
      makeItem({
        scope: "project",
        ref: `chunk:${c.ref}`,
        title: `${c.docTitle}${c.headingPath ? ` > ${c.headingPath}` : ""}`,
        snippet: c.snippet,
        uri: c.relativePath,
        authorityTier: "first_party",
        verified: true,
        score: c.score,
        statement: null,
        conflictGroup: `doc:${c.docId}`,
        capturedAt: null,
      })
    );
  },
});

registerKnowledgeProvider({
  scope: "company-facts",
  label: "公司事实（已确认 / 待确认）",
  search: async (ctx) => {
    const r = await ctx.searchKnowledgeOnce();
    return r.facts.map((f) =>
      makeItem({
        scope: "company-facts",
        ref: `fact:${f.id}`,
        title: f.label,
        snippet: `${f.value}`,
        uri: `company-fact:${f.id}`,
        authorityTier: "first_party",
        verified: f.status === "CONFIRMED",
        score: f.status === "CONFIRMED" ? 10 : 5,
        statement: `${f.label}：${f.value}`,
        conflictGroup: `factkey:${f.key}`,
        capturedAt: null,
      })
    );
  },
});

/** 业务库快照：产品与项目的状态类事实（结构化，不是文档）。 */
registerKnowledgeProvider({
  scope: "db",
  label: "业务数据库（产品 / 项目当前状态）",
  search: async (ctx) => {
    const kws = keywords(ctx.query);
    const [products, projects] = await Promise.all([
      prisma.product.findMany({
        where: { organizationId: ctx.session.organizationId },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          name: true,
          identityCode: true,
          lifecycleStage: true,
          coreIdea: true,
          updatedAt: true,
        },
      }),
      prisma.project.findMany({
        where: { organizationId: ctx.session.organizationId },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { id: true, title: true, stage: true, target: true, updatedAt: true },
      }),
    ]);

    const out: KnowledgeResultItem[] = [];
    for (const p of products) {
      const text = `${p.name} ${p.identityCode} ${p.coreIdea ?? ""} ${p.lifecycleStage}`;
      const score = relevanceScore(text, p.name, kws);
      if (score <= 0) continue;
      out.push(
        makeItem({
          scope: "db",
          ref: `product:${p.id}`,
          title: `产品 ${p.name}（${p.identityCode}）`,
          snippet: `${p.lifecycleStage}｜${p.coreIdea ?? "（未填核心概念）"}`,
          uri: `product:${p.id}`,
          authorityTier: "first_party",
          verified: true,
          score,
          statement: `${p.name} 生命周期阶段：${p.lifecycleStage}`,
          conflictGroup: `product-stage:${p.id}`,
          capturedAt: p.updatedAt.toISOString(),
        })
      );
    }
    for (const pj of projects) {
      const text = `${pj.title} ${pj.target} ${pj.stage}`;
      const score = relevanceScore(text, pj.title, kws);
      if (score <= 0) continue;
      out.push(
        makeItem({
          scope: "db",
          ref: `project:${pj.id}`,
          title: `项目 ${pj.title}`,
          snippet: `${pj.stage}｜${pj.target}`,
          uri: `project:${pj.id}`,
          authorityTier: "first_party",
          verified: true,
          score,
          statement: `${pj.title} 阶段：${pj.stage}`,
          conflictGroup: `project-stage:${pj.id}`,
          capturedAt: pj.updatedAt.toISOString(),
        })
      );
    }
    return out;
  },
});

export const FILE_PROVIDER_ROOTS = ["docs", "capabilities", "knowledge", "packs"];
const MAX_SCANNED_FILES = 600;

function walkMarkdown(roots: string[], out: { file: string; rel: string }[] = [], budget = MAX_SCANNED_FILES) {
  const cwd = process.cwd();
  for (const rootName of roots) {
    const root = pathModule.join(cwd, rootName);
    walkDir(root, rootName, out, budget);
    if (out.length >= budget) break;
  }
  return out;
}

function walkDir(
  abs: string,
  rel: string,
  out: { file: string; rel: string }[],
  budget: number
) {
  if (out.length >= budget) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= budget) return;
    const childAbs = pathModule.join(abs, e.name);
    const childRel = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
      walkDir(childAbs, childRel, out, budget);
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      out.push({ file: childAbs, rel: childRel });
    }
  }
}

/**
 * 工作区文件（仓库内 markdown）。
 * 与 `project` 的区别：`project` 是**已同步进库**的知识（有索引、有权限记录），
 * 这里是**还没同步**的本地文件，兜底用；两者去重交给 synthesis。
 */
registerKnowledgeProvider({
  scope: "files",
  label: "工作区文件（仓库内 markdown，未同步部分）",
  search: async (ctx) => {
    const kws = keywords(ctx.query);
    if (!kws.length) return [];
    const out: KnowledgeResultItem[] = [];
    for (const { file, rel } of walkMarkdown(FILE_PROVIDER_ROOTS)) {
      if (out.length >= ctx.limit) break;
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const score = relevanceScore(raw, rel, kws);
      if (score <= 0) continue;
      const titleMatch = raw.match(/^#\s+(.+)$/m);
      out.push(
        makeItem({
          scope: "files",
          ref: `file:${rel}`,
          title: titleMatch?.[1]?.trim() ?? rel,
          snippet: snippetAround(raw.replace(/[#>*`-]/g, " "), kws),
          uri: rel,
          authorityTier: "first_party",
          verified: false,
          score,
          statement: null,
          conflictGroup: `file:${rel}`,
        })
      );
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, ctx.limit);
  },
});

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

const RUN_TIMEOUT_MS = 6000;

export interface RouteKnowledgeParams {
  query: string;
  /** 请求的域；缺省 = 已注册的全部域。 */
  scopes?: (KnowledgeScope | string)[];
  limit?: number;
  now?: Date;
}

export async function routeKnowledge(
  session: SessionContext,
  params: RouteKnowledgeParams
): Promise<KnowledgeRouteResult> {
  const started = Date.now();
  const query = (params.query ?? "").trim();
  const limit = Math.max(1, params.limit ?? 5);
  const requested = (params.scopes?.length
    ? params.scopes
    : [...registry.keys()]) as (KnowledgeScope | string)[];

  const searchMemo = new Map<string, Promise<KnowledgeSearchResult>>();
  const searchKnowledgeOnce = (): Promise<KnowledgeSearchResult> => {
    let p = searchMemo.get(query);
    if (!p) {
      p = searchKnowledge(session, { query, limit: 8 });
      searchMemo.set(query, p);
    }
    return p;
  };

  const items: KnowledgeResultItem[] = [];
  const unavailable: { scope: string; reason: string }[] = [];
  const ran: string[] = [];

  if (!query) {
    return { query, requested, ran, items, unavailable, elapsedMs: Date.now() - started };
  }

  await Promise.all(
    requested.map(async (scope) => {
      const provider = registry.get(scope);
      if (!provider) {
        unavailable.push({
          scope,
          reason: MISSING_PROVIDER_NOTES[scope] ?? `provider 未实现（scope=${scope}）`,
        });
        return;
      }
      const ctx: KnowledgeProviderContext = {
        session,
        query,
        limit,
        searchKnowledgeOnce,
      };
      try {
        const blocked = provider.unavailable?.(ctx);
        if (blocked) {
          unavailable.push({ scope, reason: blocked });
          return;
        }
        const found = await withTimeout(provider.search(ctx), RUN_TIMEOUT_MS, scope);
        ran.push(scope);
        items.push(...found);
      } catch (error) {
        unavailable.push({
          scope,
          reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
      }
    })
  );

  return {
    query,
    requested,
    ran: [...new Set(ran)].sort(),
    items,
    unavailable: unavailable.sort((a, b) => a.scope.localeCompare(b.scope)),
    elapsedMs: Date.now() - started,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, scope: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`provider ${scope} 超过 ${ms}ms 未返回`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
