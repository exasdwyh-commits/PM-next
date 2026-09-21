/**
 * 成果引用与版本指纹基础设施 (C01 版本一致性)
 *
 * 背景：审批曾仅按「成果类型 + 版本数字」在项目内匹配历史成果，导致产品规格已修订为新版、
 * 决策包仍引用旧成果时依然可以通过批准（旧报告批新产品）。本模块把「权威成果」的判定收口到一处：
 *
 * 1. 决策包必须引用具体的成果 ID、精确版本、内容指纹与输入基线；
 * 2. 审批必须按 ID 从权威记录（数据库当前行）核对，禁止按类型与版本数字模糊匹配；
 * 3. 已被更新版本取代的成果引用一律判定为过期，阻断批准。
 */

import crypto from "crypto";

/** 决策包引用的成果指针：ID + 精确版本 + 内容指纹 + 输入基线 */
export interface ArtifactRef {
  id: string;
  type: string;
  version: number;
  contentHash: string;
  inputRevision: number;
}

export interface ArtifactLike {
  id: string;
  type: string;
  content: string;
  contentVersion: number;
  inputRevision: number;
  reviewStatus: string;
}

/** 不参与内容指纹的易变字段（时间戳变化不应产生新的业务版本） */
const VOLATILE_KEYS = new Set(["generatedAt", "assembledAt"]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      target[key] = stripVolatile(source[key]);
    }
    return target;
  }
  return value;
}

/** 键序稳定的序列化，保证同一业务内容永远得到同一字符串 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return JSON.stringify(stripVolatile(value));
  return JSON.stringify(value ?? null);
}

/** 成果内容指纹：JSON 内容按键序稳定化并剔除时间戳后计算 SHA-256 */
export function computeArtifactContentHash(content: string): string {
  let parsed: unknown = content;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }
  return crypto.createHash("sha256").update(stableStringify(parsed)).digest("hex");
}

export function buildArtifactRef(artifact: ArtifactLike): ArtifactRef {
  return {
    id: artifact.id,
    type: artifact.type,
    version: artifact.contentVersion,
    contentHash: computeArtifactContentHash(artifact.content),
    inputRevision: artifact.inputRevision,
  };
}

/**
 * 解析项目当前权威成果：同一类型仅取「已验收」的最高版本，历史低版本成果完整保留但不参与基线。
 */
export function resolveAuthoritativeArtifactRefs(
  artifacts: Array<Pick<ArtifactLike, "type" | "contentVersion" | "reviewStatus">>
): Array<{ type: string; version: number }> {
  const best = new Map<string, number>();
  for (const artifact of artifacts) {
    if (artifact.reviewStatus !== "ACCEPTED") continue;
    const current = best.get(artifact.type);
    if (current === undefined || artifact.contentVersion > current) {
      best.set(artifact.type, artifact.contentVersion);
    }
  }
  return [...best.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, version]) => ({ type, version }));
}

/**
 * 返回同类型中比给定版本更高的成果版本号，无则 null。
 *
 * 修订后的新版本无论当前处于待检查、已验收还是已退回，都意味着被引用版本已不是当前成果；
 * 因此这里不按状态过滤，避免“新版待检查时仍可用旧报告批准”的漏洞。
 */
export function findSupersedingVersion(
  artifacts: Array<Pick<ArtifactLike, "type" | "contentVersion">>,
  type: string,
  version: number
): number | null {
  let highest: number | null = null;
  for (const artifact of artifacts) {
    if (artifact.type !== type) continue;
    if (artifact.contentVersion > version && (highest === null || artifact.contentVersion > highest)) {
      highest = artifact.contentVersion;
    }
  }
  return highest;
}
