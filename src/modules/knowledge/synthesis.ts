/**
 * Knowledge Synthesis：把路由拿到的**原始命中**变成可以喂给模型、可以写进 Evidence 的东西。
 *
 * 四件事，按顺序：
 *  1. 去重  同一个事实的多个 provider 命中（URL 归一化 + 文本相似度）只留一条；
 *  2. 聚类  同一主题的条目归到一个 cluster，方便「一条主题、多条来源」地呈现；
 *  3. 识别冲突 同一 cluster 里出现了**不同说法**（statement 不同）→ 显式冲突，
 *            按可配置的权威优先序裁出 winner；打平就承认打平，不硬判；
 *  4. 评分  综合分 = 相关度 × 权威 × 新鲜度，给出 high/medium/low 置信度。
 *
 * 刻意不做的：不在这里改写条目内容、不补来源、不「综合出」原命中里没有的结论。
 * 缺口就是缺口——`confidence: "low"` 与空 conflicts 一样，都是诚实的输出。
 */
import type {
  KnowledgeCluster,
  KnowledgeConflict,
  KnowledgeResultItem,
  KnowledgeRouteResult,
  SynthesizedKnowledge,
} from "@/modules/kern-contracts";
import { authorityScore, freshnessFactor, loadAuthorityPolicy, type AuthorityPolicy } from "./authority";

export interface SynthesizeOptions {
  /** 相关度归一化与置信度判定用；缺省取 route.query。 */
  query?: string;
  now?: Date;
  /** 进入 `top` 的条数。 */
  limit?: number;
  maxClusters?: number;
  policy?: AuthorityPolicy;
  /** 判定「说的是同一件事」的 token Jaccard 阈值（0-1）。 */
  duplicateThreshold?: number;
}

const DEFAULT_DUPLICATE_THRESHOLD = 0.55;
/** 新鲜度在综合分里的权重（权威是硬指标，相关度是这轮的匹配度）。 */
const W_RELEVANCE = 0.4;
const W_AUTHORITY = 0.4;
const W_FRESHNESS = 0.2;

function tokens(text: string): Set<string> {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_.-]{2,}/g) ?? [];
  const cjk = lower.match(/[一-龥]+/g) ?? [];
  const out = new Set<string>(latin);
  for (const run of cjk) {
    if (run.length <= 2) out.add(run);
    else for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * 两条命中是不是在说**不同的事**。
 *
 * 反过来用它决定要不要走文本去重：`年销目标 1200 万` 与 `年销目标 800 万`
 * 共享几乎全部字面（Jaccard 远超阈值），但它们是互相矛盾的主张——
 * 按文本去重会把其中一条悄悄吃掉，冲突就再也报不出来了。
 * 所以只要两边都带 statement 且归一化后不一致，就**不是**重复。
 */
function assertsDifferentThings(a: KnowledgeResultItem, b: KnowledgeResultItem): boolean {
  if (!a.statement || !b.statement) return false;
  return normalizeStatement(a.statement) !== normalizeStatement(b.statement);
}

/** 归一化 URI：去 query/fragment、统一小写、剥尾斜杠。跨源同址靠它识别。 */
export function normalizeUri(uri: string | null): string | null {
  if (!uri) return null;
  const raw = uri.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeStatement(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s，。、；;:：,.'"“”‘’]/g, "")
    .trim();
}

function clusterKey(item: KnowledgeResultItem): string {
  if (item.conflictGroup) return `g:${item.conflictGroup}`;
  const uri = normalizeUri(item.uri);
  if (uri) return `u:${uri}`;
  return `t:${normalizeStatement(item.title)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function synthesizeKnowledge(
  route: KnowledgeRouteResult,
  options: SynthesizeOptions = {}
): SynthesizedKnowledge {
  const now = options.now ?? new Date();
  const policy = options.policy ?? loadAuthorityPolicy();
  const limit = Math.max(1, options.limit ?? 6);
  const maxClusters = Math.max(1, options.maxClusters ?? 12);
  const dupThreshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;

  // ---- 1. 去重 ----
  const dropped: { ref: string; reason: string }[] = [];
  const kept: KnowledgeResultItem[] = [];
  const seenUri = new Map<string, string>();
  const tokenCache = new Map<string, Set<string>>();

  const tokensOf = (item: KnowledgeResultItem) => {
    let t = tokenCache.get(item.ref);
    if (!t) {
      t = tokens(`${item.title} ${item.statement ?? ""} ${item.snippet}`);
      tokenCache.set(item.ref, t);
    }
    return t;
  };

  for (const item of route.items) {
    const uri = normalizeUri(item.uri);
    if (uri) {
      const prev = seenUri.get(uri);
      if (prev) {
        const prevItem = kept.find((k) => k.ref === prev);
        // 同址时保留权威更高的那条，被丢的记下来
        if (prevItem && item.authority > prevItem.authority) {
          dropped.push({ ref: prevItem.ref, reason: `与 ${item.ref} 同址且权威更低（${uri}）` });
          kept.splice(kept.indexOf(prevItem), 1);
          seenUri.set(uri, item.ref);
          kept.push(item);
        } else {
          dropped.push({ ref: item.ref, reason: `与 ${prev} 同址（${uri}）` });
        }
        continue;
      }
    }
    let duplicated = false;
    for (const prev of kept) {
      if (assertsDifferentThings(prev, item)) continue;
      if (jaccard(tokensOf(prev), tokensOf(item)) >= dupThreshold) {
        dropped.push({ ref: item.ref, reason: `与 ${prev.ref} 文本高度重复` });
        duplicated = true;
        break;
      }
    }
    if (duplicated) continue;
    if (uri) seenUri.set(uri, item.ref);
    kept.push(item);
  }

  // ---- 2. 聚类 ----
  const groups = new Map<string, KnowledgeResultItem[]>();
  for (const item of kept) {
    const key = clusterKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const precedenceRank = (item: KnowledgeResultItem) => {
    const idx = policy.precedence.indexOf(item.authorityTier);
    return idx === -1 ? policy.precedence.length : idx;
  };

  const clusters: KnowledgeCluster[] = [];
  const conflicts: KnowledgeConflict[] = [];

  for (const [key, items] of groups) {
    items.sort((a, b) => b.authority - a.authority || b.score - a.score);

    // ---- 3. 冲突：同簇内 statement 归一化后不一致 ----
    const byStatement = new Map<string, KnowledgeResultItem[]>();
    for (const it of items) {
      if (!it.statement) continue;
      const norm = normalizeStatement(it.statement);
      const list = byStatement.get(norm);
      if (list) list.push(it);
      else byStatement.set(norm, [it]);
    }
    if (byStatement.size > 1) {
      const statements = [...byStatement.entries()].map(([norm, list]) => ({
        norm,
        items: list,
        top: list.reduce((best, cur) =>
          precedenceRank(cur) < precedenceRank(best) ||
          (precedenceRank(cur) === precedenceRank(best) && cur.authority > best.authority)
            ? cur
            : best
        ),
      }));
      statements.sort((a, b) => precedenceRank(a.top) - precedenceRank(b.top) || b.top.authority - a.top.authority);
      const best = statements[0];
      const second = statements[1];
      const winner =
        best.top.authority > second.top.authority && precedenceRank(best.top) < precedenceRank(second.top)
          ? best.top.ref
          : best.top.authority !== second.top.authority
            ? best.top.ref
            : null;
      conflicts.push({
        group: key,
        reason: `同一主题下有 ${byStatement.size} 种说法，权威档 ${best.top.authorityTier}(${round2(best.top.authority)}) 高于 ${second.top.authorityTier}(${round2(second.top.authority)})`,
        statements: statements.map((s) => ({
          ref: s.top.ref,
          title: s.top.title,
          statement: s.top.statement ?? s.top.title,
          authority: round2(s.top.authority),
          capturedAt: s.top.capturedAt,
        })),
        winnerRef: winner,
      });
      // 冲突簇里的落败说法从 top 里剔除，但保留在 cluster 里（界面要能看到两种说法）
      const losers = new Set(statements.slice(1).map((s) => s.top.ref));
      for (const it of items) if (losers.has(it.ref)) dropped.push({ ref: it.ref, reason: "冲突中权威较低的一方" });
    }

    const agreement =
      byStatement.size <= 1
        ? 1
        : 1 - (byStatement.size - 1) / Math.max(1, items.length);

    clusters.push({
      id: key,
      title: items[0].title,
      items,
      agreement: round2(agreement),
      authority: round2(Math.max(...items.map((i) => i.authority))),
      freshestAt: items.map((i) => i.capturedAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null,
    });
  }

  clusters.sort((a, b) => b.authority - a.authority || b.agreement - a.agreement);
  const topClusters = clusters.slice(0, maxClusters);

  // ---- 4. 综合分与置信度 ----
  const maxRel = Math.max(1, ...kept.map((i) => i.score));
  const ranked = kept
    .map((item) => {
      const relevance = item.score / maxRel;
      const fresh = freshnessFactor(item.capturedAt, now, policy);
      const composite = W_RELEVANCE * relevance + W_AUTHORITY * item.authority + W_FRESHNESS * fresh;
      return { item, relevance, fresh, composite };
    })
    .sort((a, b) => b.composite - a.composite);

  // 冲突里落败的说法不进 top（模型不该拿着被压过的说法去下结论），但仍在 cluster 里可查。
  const loserRefs = new Set<string>();
  for (const c of conflicts) {
    if (!c.winnerRef) continue; // 打平就不淘汰，交给 Evidence 层显式呈现
    for (const s of c.statements) if (s.ref !== c.winnerRef) loserRefs.add(s.ref);
  }
  const top = ranked
    .filter((r) => !loserRefs.has(r.item.ref))
    .slice(0, limit)
    .map((r) => r.item);

  const strongClusters = topClusters.filter((c) => c.authority >= 0.5);
  const independentSources = new Set(top.map((i) => normalizeUri(i.uri) ?? i.scope)).size;
  const avgAgreement = topClusters.length
    ? topClusters.reduce((s, c) => s + c.agreement, 0) / topClusters.length
    : 0;

  let confidence: SynthesizedKnowledge["confidence"];
  if (strongClusters.length >= 3 && independentSources >= 3 && avgAgreement >= 0.8) {
    confidence = "high";
  } else if (strongClusters.length >= 1 && independentSources >= 2 && avgAgreement >= 0.5) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    query: route.query || options.query || "",
    clusters: topClusters,
    conflicts: conflicts.sort((a, b) => b.statements.length - a.statements.length),
    confidence,
    dropped,
    top,
  };
}
