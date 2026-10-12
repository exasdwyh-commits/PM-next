/**
 * C5-A3：知识路由的进程级跨轮缓存。
 *
 * - 键 = 组织 + 归一化查询 + 排序后的 scope + limit（含 sourceIds 时一并计入）。
 *   同一组织同一会话里，相同的检索请求直接复用上一轮结果。
 * - 纯内存 Map，不引入外部依赖、不碰 DB。多实例部署下缓存未命中只是多一次检索，
 *   不影响正确性。
 * - TTL 与条数上限均为 env 可配；超上限时驱逐最早写入的条目（Map 插入序）。
 */
import type { KnowledgeRouteResult } from "@/modules/kern-contracts";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function knowledgeCacheTtlMs(): number {
  return envInt("KERN_KNOWLEDGE_CACHE_TTL_MS", 120_000);
}

export function knowledgeCacheMaxEntries(): number {
  return envInt("KERN_KNOWLEDGE_CACHE_MAX_ENTRIES", 200);
}

interface CacheEntry {
  result: KnowledgeRouteResult;
  /** 写入时间（Date.now()），用于 TTL 与驱逐。 */
  writtenAt: number;
}

const cache = new Map<string, CacheEntry>();

export function knowledgeCacheKey(parts: {
  organizationId: string;
  query: string;
  scopes: string[];
  limit: number;
  sourceIds?: string[];
  /** provider 注册表版本号：同一 scope 换实现时旧缓存自动失效。 */
  registryVersion?: number;
}): string {
  const scopes = [...parts.scopes].sort().join(",");
  const sourceIds = [...(parts.sourceIds ?? [])].sort().join(",");
  return [
    parts.organizationId,
    parts.query.trim().toLowerCase(),
    scopes,
    String(parts.limit),
    sourceIds,
    String(parts.registryVersion ?? 0),
  ].join("|");
}

export function getCachedKnowledge(key: string, now = Date.now()): KnowledgeRouteResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.writtenAt > knowledgeCacheTtlMs()) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedKnowledge(
  key: string,
  result: KnowledgeRouteResult,
  now = Date.now()
): void {
  // LRU 语义：已存在先删再插，保持「最近写入在尾部」。
  cache.delete(key);
  cache.set(key, { result, writtenAt: now });
  const max = knowledgeCacheMaxEntries();
  while (cache.size > max) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 测试用：清空进程缓存。 */
export function clearKnowledgeCache(): void {
  cache.clear();
}

/** 观测用：当前条目数（Inspector/测试断言）。 */
export function knowledgeCacheSize(): number {
  return cache.size;
}
