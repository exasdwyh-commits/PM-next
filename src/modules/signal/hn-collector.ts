/**
 * C5-B3：社交/竞品信号的第一个真实采集源 —— Hacker News（Algolia 公开 API）。
 *
 * 为什么选它：
 * - 无需任何凭证（公开只读 API），满足「先接 1 个不需要凭证的真实源」；
 * - 返回结构化 JSON（title/url/points/created_at），无 HTML 解析；
 * - 技术/产品/商业讨论的社交信号：竞品发布、行业动态、工具口碑 —— 与
 *   signal 的 competitor/trend 类别对得上。
 *
 * 需要凭证的源（蝉妈妈等）继续走 manual/注入式 collector，本文件不写死任何 key。
 *
 * 取消：collect 接受可选 AbortSignal，fetch 直接透传 —— 超时/上游取消时
 * 在途 HTTP 请求被真实取消（C5-A1 同款语义）。
 */
import type { SignalCandidate, SignalCollector } from "./signal-collection";
import type { SignalSourceDef } from "./source-registry";

export const HN_ALGOLIA_SOURCE_KEY = "hn_tech_buzz";

export const HN_ALGOLIA_SOURCE_DEF: SignalSourceDef = {
  key: HN_ALGOLIA_SOURCE_KEY,
  name: "Hacker News 技术/商业动态",
  category: "trend",
  description:
    "Hacker News 热门讨论（Algolia 公开 API，无需凭证）。竞品发布、行业动态、工具口碑类社交信号；verifyStatus 恒 UNVERIFIED。",
  priority: "P3",
  mode: "auto",
};

const HN_API = "https://hn.algolia.com/api/v1/search";

export interface HnCollectOptions {
  /** 每次采集取回条数上限（默认 20）。 */
  limit?: number;
  /** 最低热度（points），过滤水帖（默认 20）。 */
  minPoints?: number;
}

/**
 * 按关键词从 HN 抓取相关讨论。query 为空时取当日热门（front_page）。
 * 返回 SignalCandidate[]；网络失败抛错（由 runSignalCollection 记为 error，不虚构）。
 */
export async function collectHackerNews(
  query: string,
  opts: HnCollectOptions = {},
  signal?: AbortSignal
): Promise<SignalCandidate[]> {
  signal?.throwIfAborted();
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const minPoints = opts.minPoints ?? 20;
  const q = query.trim();

  const url = q
    ? `${HN_API}?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${limit}`
    : `${HN_API}?tags=front_page&hitsPerPage=${limit}`;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  // 自身超时 15s：采集是后台任务，不能无限等。
  const timer = setTimeout(() => ctrl.abort(new Error("HN 采集超时（15s）")), 15_000);
  if (typeof timer.unref === "function") timer.unref();

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "kern-signal-collector/1.0" },
    });
    if (!res.ok) throw new Error(`HN API 返回 ${res.status}`);
    const data = (await res.json()) as { hits?: unknown[] };
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const out: SignalCandidate[] = [];
    for (const h of hits) {
      if (!h || typeof h !== "object") continue;
      const hit = h as Record<string, unknown>;
      const title = typeof hit.title === "string" ? hit.title.trim() : "";
      if (!title) continue;
      const points = typeof hit.points === "number" ? hit.points : 0;
      if (points < minPoints) continue;
      const hnUrl =
        typeof hit.url === "string" && hit.url
          ? hit.url
          : typeof hit.objectID === "string"
            ? `https://news.ycombinator.com/item?id=${hit.objectID}`
            : null;
      out.push({
        title: title.slice(0, 200),
        summary: `HN 热度 ${points}（未核验，仅作信号线索）`,
        url: hnUrl,
        category: "trend",
        importance: Math.min(5, 1 + Math.floor(points / 100)),
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 接入 signal-collection 的 collector（query 由调用方按需传入，默认取热门）。 */
export function createHackerNewsCollector(query = ""): SignalCollector {
  return {
    mode: "hn_algolia",
    collect: async () => collectHackerNews(query),
  };
}
