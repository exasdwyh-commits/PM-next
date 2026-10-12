/**
 * KX-53 网页爬取提供方（crawl4ai）。
 *
 * 与 KX-52 的 web_fetch 互补：
 *  - web_fetch：本进程直连取正文（safeFetch + htmlToText），快、省，但拿不到 JS 渲染出来的内容。
 *  - web_crawl：把网址交给带浏览器的 crawl4ai 服务渲染后再取，能处理 JS 站点，
 *    一次可批量多个 URL，返回干净 Markdown 与站内链接，供模型继续下钻。
 *
 * 本进程不跑浏览器，端点由环境变量给出：
 *   KERN_CRAWL_ENDPOINT=http://127.0.0.1:11235   # crawl4ai Docker 服务（必填，不配则不提供 web_crawl）
 *   KERN_CRAWL_TOKEN=<CRAWL4AI_API_TOKEN>        # 服务端开了 token 门时必须给
 *   KERN_CRAWL_MAX_URLS=5                        # 单次最多抓几个 URL（默认 5，上限 20）
 *   KERN_CRAWL_FILTER=fit                        # fit | raw，默认 fit（去噪后的 Markdown）
 *   KERN_CRAWL_RESPECT_ROBOTS=false              # 默认 true：让服务端按 robots.txt 放行
 *   KERN_CRAWL_TIMEOUT_MS=30000                  # 单次请求超时（默认 30s）
 *
 * 服务端契约（crawl4ai Docker，端口 11235）：
 *   POST {endpoint}/crawl
 *   headers: Authorization: Bearer <token>（配了 token 时）
 *   body:    {"urls":[...],"crawler_config":{"type":"CrawlerRunConfig","params":{...}}}
 *   resp:    {"success":true,"results":[{"url","status_code","markdown":{"raw_markdown","fit_markdown"},
 *                                       "links":{"internal":[{"href","text"}]},"metadata":{"title"}}]}
 * 缺 token / token 不对时服务返回 401。
 *
 * 两段安全边界，别搞混：
 *  1) 目标 URL（模型给的）→ 逐个过 validatePublicUrl：只放行公网 http/https，
 *     挡回环 / 内网 / 链路本地 / 云元数据 / 带凭据的地址。
 *  2) 服务端点（管理员配的）→ 视为可信服务，直接用 fetch。
 *     这里**不能**用 safeFetch —— 它会把 127.0.0.1 也挡掉，而端点恰恰常在本机。
 * crawl4ai 0.9.2+ 服务端自身也会挡内网目标（返回 "URL blocked"），那是第二道防线，不是替代。
 */
import { validatePublicUrl } from "@/shared/net/safe-fetch";

/** 单页正文上限：服务端可能返回整页，先截一刀，避免一次把上下文打爆。 */
const MAX_PAGE_TEXT = 8000;
const MAX_LINKS = 30;

export type CrawledPage = {
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
  /** 站内链接（已去重、限长），模型可据此继续下钻。 */
  links: string[];
};
export type WebCrawlFn = (urls: string[], signal?: AbortSignal) => Promise<CrawledPage[]>;

let override: WebCrawlFn | null | undefined;
/** 仅供测试：替换爬取实现（传 null 表示「未配置」）。 */
export function setWebCrawlForTest(fn: WebCrawlFn | null | undefined) {
  override = fn;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** crawl4ai 的 markdown 可能是字符串（/md）或对象（/crawl，含 raw/fit 两份）。 */
function pickMarkdown(md: unknown, filter: "fit" | "raw"): string | null {
  if (typeof md === "string") return md.trim() ? md : null;
  if (md && typeof md === "object") {
    const o = md as Record<string, unknown>;
    const keys = filter === "raw" ? ["raw_markdown", "fit_markdown"] : ["fit_markdown", "raw_markdown"];
    for (const k of keys) if (typeof o[k] === "string" && (o[k] as string).trim()) return o[k] as string;
  }
  return null;
}

/** links.internal 在不同版本里可能是字符串数组或 {href,text} 数组。 */
function pickLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const href = typeof item === "string" ? item : item && typeof item === "object" ? (item as Record<string, unknown>).href : null;
    if (typeof href !== "string" || !/^https?:\/\//.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** 返回当前可用的爬取函数；未配置端点返回 null。 */
export function getWebCrawl(env: NodeJS.ProcessEnv = process.env): WebCrawlFn | null {
  if (override !== undefined) return override;
  const rawEndpoint = (env.KERN_CRAWL_ENDPOINT ?? "").trim();
  if (!rawEndpoint) return null;
  let endpoint: string;
  try {
    const u = new URL(rawEndpoint);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    endpoint = u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
  const token = (env.KERN_CRAWL_TOKEN ?? "").trim();
  const maxUrls = clampInt(env.KERN_CRAWL_MAX_URLS, 5, 1, 20);
  const filter: "fit" | "raw" = (env.KERN_CRAWL_FILTER ?? "fit").toLowerCase() === "raw" ? "raw" : "fit";
  const respectRobots = !["false", "off", "0"].includes((env.KERN_CRAWL_RESPECT_ROBOTS ?? "true").toLowerCase());
  const timeoutMs = clampInt(env.KERN_CRAWL_TIMEOUT_MS, 30_000, 1_000, 120_000);

  return async (urls, signal) => {
    const wanted = urls.map((u) => String(u).trim()).filter(Boolean).slice(0, maxUrls);
    if (!wanted.length) return [];
    // 目标逐个过公网校验；任何一个不合法就整体失败并指名，绝不静默丢弃
    //（静默丢弃会让模型以为自己抓到了）。
    const targets: string[] = [];
    for (const u of wanted) {
      const safe = await validatePublicUrl(u);
      targets.push(safe.toString());
    }

    const ctrl = new AbortController();
    const abort = () => ctrl.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint}/crawl`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          urls: targets,
          crawler_config: {
            type: "CrawlerRunConfig",
            params: { cache_mode: "bypass", check_robots_txt: respectRobots },
          },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`爬取服务返回 ${res.status}`);
      const data = (await res.json()) as { success?: boolean; results?: unknown; detail?: unknown };
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) {
        const reason = data.success === false ? String(data.detail ?? "服务返回 success=false") : "服务未返回任何结果";
        throw new Error(reason);
      }

      const pages: CrawledPage[] = [];
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const markdown = pickMarkdown(rec.markdown, filter);
        if (!markdown) continue;
        const text = markdown.replace(/\r\n/g, "\n").trim();
        if (!text) continue;
        const truncated = text.length > MAX_PAGE_TEXT;
        const metadata = rec.metadata && typeof rec.metadata === "object" ? (rec.metadata as Record<string, unknown>) : null;
        const metaTitle = metadata && typeof metadata.title === "string" ? metadata.title.trim() : "";
        const links = pickLinks((rec.links as Record<string, unknown> | undefined)?.internal);
        pages.push({
          url: typeof rec.url === "string" && rec.url ? rec.url : targets[pages.length] ?? "",
          title: metaTitle || null,
          text: truncated ? text.slice(0, MAX_PAGE_TEXT) : text,
          truncated,
          links,
        });
      }
      return pages;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
}
