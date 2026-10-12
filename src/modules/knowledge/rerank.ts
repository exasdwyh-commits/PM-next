/**
 * C5-A4：跨 provider 结果重排（可解释打分）。
 *
 * 背景：各 provider 的 `score` 是「自己域内可比」的数（有的按命中词数、有的按
 * 引擎位次），直接跨域比较会让某个域的条目系统性压过别的域。重排在路由合并时
 * 统一做一次归一化，让多源结果按同一把尺子排。
 *
 * 打分因子（权重写死在代码里、有据可查，见下）：
 *   finalScore = 0.50 * normScore
 *              + 0.35 * authority
 *              + 0.10 * (verified ? 1 : 0)
 *              + 0.05 * freshness
 * 其中：
 * - normScore：item.score / 同 scope 内最大 score（0-1）。跨域不可比 ⇒ 只在域内归一化。
 * - authority：已有的 0-1 权威分（authorityScore），不重新发明权威。
 * - verified：有明确确认状态的 +0.10（公司事实 CONFIRMED、已同步文档 verified=true）。
 * - freshness：capturedAt 在 90 天内线性衰减 0→1，超出 90 天为 0；未知时间为 0。
 *   新鲜度只占 0.05 —— 检索是「找对的东西」，不是「找新的东西」。
 *
 * 产物：给每条 item 附 `rerankScore`（原 score 不动，便于回溯），按 finalScore
 * 降序排。synthesis.ts 有自己的排序逻辑（权威/冲突裁决），不受这里影响。
 */
import type { KnowledgeResultItem } from "@/modules/kern-contracts";

export const RERANK_WEIGHTS = {
  normScore: 0.5,
  authority: 0.35,
  verified: 0.1,
  freshness: 0.05,
} as const;

export const RERANK_FRESHNESS_WINDOW_DAYS = 90;

export interface RerankDetail {
  normScore: number;
  authority: number;
  verifiedBonus: number;
  freshnessBonus: number;
  finalScore: number;
}

export function rerankDetail(item: KnowledgeResultItem, maxScoreInScope: number, now = Date.now()): RerankDetail {
  const normScore = maxScoreInScope > 0 ? Math.min(1, Math.max(0, item.score / maxScoreInScope)) : 0;
  const authority = Math.min(1, Math.max(0, item.authority ?? 0));
  const verifiedBonus = item.verified ? RERANK_WEIGHTS.verified : 0;
  let freshnessBonus = 0;
  if (item.capturedAt) {
    const ageMs = now - new Date(item.capturedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      const windowMs = RERANK_FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      freshnessBonus = RERANK_WEIGHTS.freshness * Math.max(0, 1 - ageMs / windowMs);
    }
  }
  const finalScore =
    RERANK_WEIGHTS.normScore * normScore +
    RERANK_WEIGHTS.authority * authority +
    verifiedBonus +
    freshnessBonus;
  return { normScore, authority, verifiedBonus, freshnessBonus, finalScore };
}

/**
 * 多源合并重排（纯函数）。返回新数组，原数组不动；每条附 rerankScore。
 */
export function rerankKnowledgeItems(
  items: KnowledgeResultItem[],
  now = Date.now()
): KnowledgeResultItem[] {
  const maxByScope = new Map<string, number>();
  for (const item of items) {
    const cur = maxByScope.get(item.scope) ?? 0;
    if (item.score > cur) maxByScope.set(item.scope, item.score);
  }
  return items
    .map((item) => {
      const detail = rerankDetail(item, maxByScope.get(item.scope) ?? 0, now);
      return { ...item, rerankScore: detail.finalScore };
    })
    .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
}
