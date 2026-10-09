/**
 * 权威（Authority）与新鲜度（Freshness）的**可配置**策略。
 *
 * 为什么不写死在 synthesis.ts 里：
 *  - 不同部署方对「谁说了算」的判断不一样（法规站 > 论文 > 媒体，还是反过来）；
 *  - 冲突裁决必须能被复盘：给出的是「按哪张表判的」，而不是「代码里第几行」；
 *  - 表改了要有迹可循，所以策略带 `source`（default / env）。
 *
 * 配置方式：环境变量 `KERN_AUTHORITY_POLICY` 是一段 JSON，字段任选、缺省用默认值：
 *   {"tierWeights":{"first_party":1,"curated":0.7,"public":0.4,"unknown":0.1},
 *    "verifiedBoost":0.2,"freshnessHalfLifeDays":120,
 *    "precedence":["first_party","curated","public","unknown"]}
 * 非法 JSON / 非法字段 → 忽略该项并回落默认，不让一个写错的环境变量打挂知识路由。
 */
import type { AuthorityTier } from "@/modules/kern-contracts";

export interface AuthorityPolicy {
  /** 各权威档的基础权重（0-1）。 */
  tierWeights: Record<AuthorityTier, number>;
  /** 已确认（verified）来源的加成，叠加不封顶由 clamp 决定。 */
  verifiedBoost: number;
  /** 新鲜度半衰期（天）：越旧权重越低，每过一个半衰期权重减半。 */
  freshnessHalfLifeDays: number;
  /** 冲突裁决时的权威优先序（前者压后者）。相同则看分数与时间。 */
  precedence: AuthorityTier[];
  /** 这张表从哪来，进 Inspector 便于复盘。 */
  source: "default" | "env";
}

export const DEFAULT_AUTHORITY_POLICY: AuthorityPolicy = {
  tierWeights: {
    first_party: 1,
    curated: 0.72,
    public: 0.45,
    unknown: 0.2,
  },
  verifiedBoost: 0.18,
  freshnessHalfLifeDays: 180,
  precedence: ["first_party", "curated", "public", "unknown"],
  source: "default",
};

const TIERS: AuthorityTier[] = ["first_party", "curated", "public", "unknown"];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

let cached: AuthorityPolicy | null = null;

/** 读 env 并合并到默认表（结果进程内缓存；`clearAuthorityPolicyCache()` 供测试用）。 */
export function loadAuthorityPolicy(env: NodeJS.ProcessEnv = process.env): AuthorityPolicy {
  if (cached) return cached;
  const raw = env.KERN_AUTHORITY_POLICY?.trim();
  if (!raw) return DEFAULT_AUTHORITY_POLICY;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthorityPolicy>;
    const tierWeights = { ...DEFAULT_AUTHORITY_POLICY.tierWeights };
    if (parsed.tierWeights && typeof parsed.tierWeights === "object") {
      for (const t of TIERS) {
        const v = (parsed.tierWeights as Record<string, unknown>)[t];
        if (typeof v === "number") tierWeights[t] = clamp01(v);
      }
    }
    const precedence = Array.isArray(parsed.precedence)
      ? (parsed.precedence.filter((t) => TIERS.includes(t as AuthorityTier)) as AuthorityTier[])
      : DEFAULT_AUTHORITY_POLICY.precedence;
    cached = {
      tierWeights,
      verifiedBoost:
        typeof parsed.verifiedBoost === "number" ? clamp01(parsed.verifiedBoost) : DEFAULT_AUTHORITY_POLICY.verifiedBoost,
      freshnessHalfLifeDays:
        typeof parsed.freshnessHalfLifeDays === "number" && parsed.freshnessHalfLifeDays > 0
          ? parsed.freshnessHalfLifeDays
          : DEFAULT_AUTHORITY_POLICY.freshnessHalfLifeDays,
      precedence: precedence.length ? precedence : DEFAULT_AUTHORITY_POLICY.precedence,
      source: "env",
    };
  } catch {
    cached = DEFAULT_AUTHORITY_POLICY;
  }
  return cached;
}

export function clearAuthorityPolicyCache(): void {
  cached = null;
}

/** 信任档 → 权威档。复用 evidence/source-trust 的分类表，不在知识层另立一套。 */
export function trustTierToAuthorityTier(
  trustTier: "OFFICIAL" | "PRIMARY" | "REPUTABLE" | "UNRATED"
): AuthorityTier {
  switch (trustTier) {
    case "OFFICIAL":
      return "first_party";
    case "PRIMARY":
    case "REPUTABLE":
      return "curated";
    default:
      return "unknown";
  }
}

/** 新鲜度系数：0-1，按半衰期指数衰减；没有时间戳时给一个保守的中性值。 */
export function freshnessFactor(capturedAt: string | null, now: Date, policy: AuthorityPolicy): number {
  if (!capturedAt) return 0.6;
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return 0.6;
  const ageDays = Math.max(0, (now.getTime() - t) / 86_400_000);
  return Math.pow(0.5, ageDays / policy.freshnessHalfLifeDays);
}

/** 综合权威分：档位权重 + 已确认加成（封顶 1）。 */
export function authorityScore(
  tier: AuthorityTier,
  verified: boolean,
  policy: AuthorityPolicy
): number {
  const base = policy.tierWeights[tier] ?? 0;
  return clamp01(base + (verified ? policy.verifiedBoost : 0));
}

/** 新鲜度的人话标签（EvidenceClaim.freshness 与 prompt 展示共用，别各写一份）。 */
export function freshnessLabel(capturedAt: string | null, now: Date = new Date()): string {
  if (!capturedAt) return "UNKNOWN";
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return "UNKNOWN";
  const days = (now.getTime() - t) / 86_400_000;
  if (days <= 30) return "RECENT";
  if (days <= 180) return "CURRENT";
  return "STALE";
}
