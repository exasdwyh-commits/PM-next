/**
 * 词汇宪法：四轴「这条信息是什么性质、有多可信」的唯一词表来源。
 *
 * 为什么需要它：同一个概念此前分裂成多套互不兼容的词表 —— 同一个「内部」在两个界面有两个说法
 * （内部来源 / 内部记录），同一个「证据等级」有 4 种取值（UNKNOWN|ASSUMED|SUPPORTED|VERIFIED /
 * UNKNOWN|WEAK|SUPPORTED|STRONG|VERIFIED / A|B|C|D / HIGH|MEDIUM|LOW）。而 `labelOf` 的兜底是
 * `map[key] ?? key` —— 映射不到就把英文键名直接显示给用户（页面上曾出现「证据 HIGH」）。
 *
 * 本模块把四轴收口，并让每个适配器**接受一切历史写法**，使显示层永远能落到中文。
 * 新增取值必须同时补标签，否则 `tests/vocabulary-contract.test.ts` 转红。
 *
 * 四个轴相互独立，不可压成一个词：
 *  A 主张依据 ClaimBasis       —— 这句话是什么（事实 / 推断 / 假设 / 未知）
 *  B 来源权威 SourceAuthority  —— 这个来源有多可信（已确认 / 内部 / 精选 / 公开 / 未评级）
 *  C 证据强度 EvidenceStrength —— 有多少独立证据支撑（已核实 / 强 / 有支撑 / 弱 / 假设 / 未知）
 *  D 来源出处 SourceProvenance —— 这份材料是谁给的（用户 / 内部 / 外部 / 模型）
 *
 * C 与 D 的区别：D 是**出处**（谁提供的），C 是**支撑强度**（有多少独立证据）——
 * 同一条「内部记录」可以是强支撑也可以是弱支撑，所以它们是两个轴，不是同一个轴的两个档。
 * B 与 D 同理：来源可以「来自外部」（D）但仍然「权威」（B，例如法规原文）。
 *
 * 设计约束（改本文件前先读）：
 *  - 纯常量 + 纯函数，**零 import**（本文件在 L5，不得依赖任何 modules/*，否则架构守卫转红）。
 *  - 适配器一律大小写不敏感；认不出的返回兜底值，绝不返回空串、绝不抛异常。
 *  - 大小写沿用各轴在代码里**已经占多数**的写法以降低迁移量：A/B/D 小写，C 大写
 *    （C 的多数写入方是 evidence/verifier，落库值即大写）。
 */

// ── 轴 A：主张依据 ────────────────────────────────────────────
// 对应旧词表：artifacts `Basis`（同值）、status-labels `EVIDENCE_CLAIM_KIND_LABELS`（大写 FACT 等）、
// response-format `ClaimKind` + `CLAIM_LABEL`（本轴子集，无 assumption）。
export const CLAIM_BASES = ["fact", "inference", "assumption", "unknown"] as const;
export type ClaimBasis = (typeof CLAIM_BASES)[number];

export const CLAIM_BASIS_LABEL: Record<ClaimBasis, string> = {
  fact: "事实",
  inference: "推断",
  assumption: "假设",
  unknown: "未知",
};

/** 认得出的一切写法（含大小写变体）→ canonical。 */
const CLAIM_BASIS_ALIASES: Record<string, ClaimBasis> = {
  fact: "fact",
  inference: "inference",
  assumption: "assumption",
  // 旧 `EVIDENCE_LEVEL_LABELS` 用过 ASSUMED 表示「只是假设」
  assumed: "assumption",
  unknown: "unknown",
};

export function isClaimBasis(raw: unknown): raw is ClaimBasis {
  return typeof raw === "string" && (CLAIM_BASES as readonly string[]).includes(raw);
}

export function claimBasisOf(raw: unknown): ClaimBasis {
  if (typeof raw !== "string") return "unknown";
  return CLAIM_BASIS_ALIASES[raw.trim().toLowerCase()] ?? "unknown";
}

/** 显示用：任何历史写法都返回中文，绝不把英文键名漏给用户。 */
export function claimBasisLabel(raw: unknown): string {
  return CLAIM_BASIS_LABEL[claimBasisOf(raw)];
}

// ── 轴 B：来源权威 ────────────────────────────────────────────
// 对应旧词表：knowledge `AuthorityTier`（first_party/curated/public/unknown）、muse `Confidence`（同值）。
export const SOURCE_AUTHORITIES = ["confirmed", "internal", "curated", "public", "unrated"] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

export const SOURCE_AUTHORITY_LABEL: Record<SourceAuthority, string> = {
  confirmed: "已确认",
  internal: "内部来源",
  curated: "精选来源",
  public: "公开来源",
  unrated: "未评级",
};

/**
 * 由知识层的 `AuthorityTier` + `verified` 折算来源权威档。
 *
 * ⚠️ 上游没给档位时**必须**落到 `unrated`，绝不猜一个：猜出来的「已确认」是假绿标，
 * 比老实说「未评级」更难被发现（未评级 ≠ 不可信）。
 */
export function sourceAuthorityOf(meta: { authorityTier?: unknown; verified?: unknown }): SourceAuthority {
  const tier = typeof meta?.authorityTier === "string" ? meta.authorityTier : "";
  const verified = meta?.verified === true;
  switch (tier) {
    case "first_party":
      return verified ? "confirmed" : "internal";
    case "curated":
      return "curated";
    case "public":
      return "public";
    default:
      return "unrated";
  }
}

export function sourceAuthorityLabel(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (SOURCE_AUTHORITY_LABEL as Record<string, string>)[key] ?? SOURCE_AUTHORITY_LABEL.unrated;
}

// ── 轴 C：证据强度 ────────────────────────────────────────────
// 对应旧词表：evidence/verifier（UNKNOWN|WEAK|SUPPORTED|STRONG|VERIFIED）、
// status-labels `EVIDENCE_LEVEL_LABELS`（含 ASSUMED）、visual-intelligence（A–D）、
// evidence-bridge（按权威分归一的 HIGH|MEDIUM|LOW）。
export const EVIDENCE_STRENGTHS = ["VERIFIED", "STRONG", "SUPPORTED", "WEAK", "ASSUMED", "UNKNOWN"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export const EVIDENCE_STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  VERIFIED: "已核实",
  STRONG: "强支撑",
  SUPPORTED: "有支撑",
  WEAK: "弱支撑",
  ASSUMED: "假设",
  UNKNOWN: "未知",
};

/** 认得出的一切写法（大小写不敏感）→ canonical。 */
const EVIDENCE_STRENGTH_ALIASES: Record<string, EvidenceStrength> = {
  verified: "VERIFIED",
  strong: "STRONG",
  supported: "SUPPORTED",
  weak: "WEAK",
  assumed: "ASSUMED",
  unknown: "UNKNOWN",
  none: "UNKNOWN",
  // 旧 evidence-bridge：按权威分归一的 HIGH / MEDIUM / LOW
  high: "STRONG",
  medium: "SUPPORTED",
  low: "WEAK",
  // 旧 visual-intelligence / 原料档案：字母级 A–D
  a: "STRONG",
  b: "SUPPORTED",
  c: "WEAK",
  d: "UNKNOWN",
};

export function evidenceStrengthOf(raw: unknown): EvidenceStrength {
  if (typeof raw !== "string") return "UNKNOWN";
  return EVIDENCE_STRENGTH_ALIASES[raw.trim().toLowerCase()] ?? "UNKNOWN";
}

/**
 * 显示用：`HIGH` / `A` / `weak` / `SUPPORTED` 一律收敛成中文。
 * 这是修掉「页面上出现『证据 HIGH』」那个 bug 的入口。
 */
export function evidenceStrengthLabel(raw: unknown): string {
  return EVIDENCE_STRENGTH_LABEL[evidenceStrengthOf(raw)];
}

/**
 * 由 0-1 权威分归一到证据强度（沿用 evidence-bridge 的历史分档阈值 0.7 / 0.4）。
 * 把分档收敛到这里，避免各写入方各自发明一套 HIGH/MEDIUM/LOW。
 */
export function evidenceStrengthFromAuthority(authority: number): EvidenceStrength {
  if (!Number.isFinite(authority)) return "UNKNOWN";
  if (authority >= 0.7) return "STRONG";
  if (authority >= 0.4) return "SUPPORTED";
  return "WEAK";
}

// ── 轴 D：来源出处 ────────────────────────────────────────────
// 对应旧词表：artifacts `SourceTrust`（同值）、visual-intelligence 里的一份重复定义（已删）。
export const SOURCE_PROVENANCES = ["user", "internal", "external", "model"] as const;
export type SourceProvenance = (typeof SOURCE_PROVENANCES)[number];

export const SOURCE_PROVENANCE_LABEL: Record<SourceProvenance, string> = {
  user: "用户提供",
  internal: "内部记录",
  external: "外部未核实",
  model: "模型知识·未核实",
};

export function isSourceProvenance(raw: unknown): raw is SourceProvenance {
  return typeof raw === "string" && (SOURCE_PROVENANCES as readonly string[]).includes(raw);
}

/**
 * 兜底取 `external`（外部未核实）而不是 internal/model —— 认不出出处时，
 * 唯一诚实的选择是「当作未核实的外部材料」，不能默认成自家记录或模型知识。
 * 大小写不敏感（`isSourceProvenance` 是严格类型守卫，不能放宽，故这里单独归一）。
 */
export function sourceProvenanceOf(raw: unknown): SourceProvenance {
  if (typeof raw !== "string") return "external";
  const key = raw.trim().toLowerCase();
  return (SOURCE_PROVENANCES as readonly string[]).includes(key) ? (key as SourceProvenance) : "external";
}

export function sourceProvenanceLabel(raw: unknown): string {
  return SOURCE_PROVENANCE_LABEL[sourceProvenanceOf(raw)];
}
