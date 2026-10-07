/**
 * KX-52 网页检索提供方。按环境变量选择，没配置就不提供 web_search：
 *   KERN_SEARCH_PROVIDER=tavily  + TAVILY_API_KEY
 *   KERN_SEARCH_PROVIDER=brave   + BRAVE_SEARCH_API_KEY
 *   KERN_SEARCH_PROVIDER=searxng + SEARXNG_URL（自建实例，走 safeFetch 以外的固定地址）
 *   KERN_SEARCH_PROVIDER=metaso + METASO_SEARCH_API_KEY（或 METASO_API_KEY）
 * 提供方地址固定；正文可使用本地安全抓取或经过公网地址校验的秘塔 reader。
 */
import { requestMetaso } from "./metaso";
export type WebHit = { title: string; url: string; snippet: string };
export type WebSearchFn = (query: string, limit: number, signal?: AbortSignal) => Promise<WebHit[]>;

let override: WebSearchFn | null | undefined;
export function setWebSearchForTest(fn: WebSearchFn | null | undefined) {
  override = fn;
}

async function json(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const ctrl = new AbortController();
  const abort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`检索服务返回 ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", abort);
  }
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** 返回当前可用的检索函数；未配置返回 null。 */
export function getWebSearch(env: NodeJS.ProcessEnv = process.env): WebSearchFn | null {
  if (override !== undefined) return override;
  const provider = (env.KERN_SEARCH_PROVIDER ?? "").toLowerCase();
  if (provider === "metaso" && (env.METASO_SEARCH_API_KEY || env.METASO_API_KEY)) {
    const key = (env.METASO_SEARCH_API_KEY || env.METASO_API_KEY)!;
    return async (query, limit, signal) => {
      const size = Math.max(1, Math.min(10, Math.floor(limit) || 5));
      const data = await requestMetaso("search", key, { q: query, scope: "webpage", size, includeSummary: true }, signal);
      if (!Array.isArray(data.webpages)) throw new Error("秘塔搜索结果格式无效");
      return data.webpages.slice(0, size).flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const hit = item as Record<string, unknown>;
        if (typeof hit.link !== "string") return [];
        try { const url = new URL(hit.link); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return []; } catch { return []; }
        return [{ title: clip(hit.title, 200), url: hit.link, snippet: clip(hit.snippet || hit.summary, 400) }];
      });
    };
  }
  if (provider === "tavily" && env.TAVILY_API_KEY) {
    const key = env.TAVILY_API_KEY;
    return async (query, limit, signal) => {
      const d = (await json("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: limit }),
      }, signal)) as { results?: { title?: string; url?: string; content?: string }[] };
      return (d.results ?? []).map((x) => ({ title: clip(x.title, 200), url: String(x.url ?? ""), snippet: clip(x.content, 400) }));
    };
  }
  if (provider === "brave" && env.BRAVE_SEARCH_API_KEY) {
    const key = env.BRAVE_SEARCH_API_KEY;
    return async (query, limit, signal) => {
      const d = (await json(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
        headers: { accept: "application/json", "x-subscription-token": key },
      }, signal)) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      return (d.web?.results ?? []).map((x) => ({ title: clip(x.title, 200), url: String(x.url ?? ""), snippet: clip(x.description?.replace(/<[^>]+>/g, ""), 400) }));
    };
  }
  if (provider === "searxng" && env.SEARXNG_URL) {
    const base = env.SEARXNG_URL.replace(/\/+$/, "");
    return async (query, limit, signal) => {
      const d = (await json(`${base}/search?format=json&q=${encodeURIComponent(query)}`, {}, signal)) as {
        results?: { title?: string; url?: string; content?: string }[];
      };
      return (d.results ?? []).slice(0, limit).map((x) => ({ title: clip(x.title, 200), url: String(x.url ?? ""), snippet: clip(x.content, 400) }));
    };
  }
  return null;
}
