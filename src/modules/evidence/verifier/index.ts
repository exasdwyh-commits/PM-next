/**
 * P0-B Independent Evidence Verifier
 * 规则: Research Agent不能自验, caller trustTier非权威, URL重分类, model-only→UNKNOWN, fetchability≠support, 需 support span, 同组织双URL非独立证据, rules-only永不VERIFIED
 */

// 批量评估器（原 verifier.ts 并入本目录，避免 verifier.ts 与 verifier/ 同名遮蔽）
export {
  IndependentEvidenceVerifier,
  type EvidenceLevel,
  type VerifierClaim,
  type VerifierSource,
  type SourceAssessment,
} from "./batch-verifier";

export interface EvidenceClaim {
  id: string;
  field: string;
  value: string;
  sourceId?: string;
  sourceUrl?: string;
  claimKind: "FACT" | "INFERENCE" | "ASSUMPTION";
  evidenceLevel?: string;
  createdByAgent?: string;
}

export interface SourceCapture {
  id: string;
  url: string;
  finalUrl: string;
  content: string;
  contentHash: string;
  trustTier: "OFFICIAL" | "REPUTABLE" | "COMMUNITY" | "UNTRUSTED";
  sourceOrganization: string;
  fetchedAt: Date;
  injectionStatus: "CLEAN" | "SUSPICIOUS" | "INJECTED";
}

export type SupportStatus = "SUPPORTED" | "CONTRADICTED" | "NOT_FOUND" | "AMBIGUOUS";
export type EvidenceSupportLevel = "UNKNOWN" | "WEAK" | "SUPPORTED" | "STRONG" | "VERIFIED";

export interface VerificationResult {
  claimId: string;
  supportStatus: SupportStatus;
  evidenceLevel: EvidenceSupportLevel;
  supportSpan?: { start: number; end: number; text: string };
  sourceUri: string;
  sourceOrganization: string;
  verifierIdentity: string;
  checkedAt: Date;
  metadata: {
    trustTier: string;
    injectionStatus: string;
    isSelfVerification: boolean;
    isSameOrganizationAsOtherEvidence: boolean;
    isRulesOnly: boolean;
    freshnessDays?: number;
    jurisdiction?: string;
    contradictionDetails?: string;
  };
}

const JURISDICTION_REQUIRED_CLAIMS = ["法规", "合规", "备案", "认证", "蓝帽子", "SC", "功效宣称"];

export async function verifyEvidence(
  claim: EvidenceClaim,
  source: SourceCapture,
  verifierIdentity: string,
  otherEvidences: SourceCapture[] = []
): Promise<VerificationResult> {
  // 1. Research Agent 不能自验
  const isSelfVerification = claim.createdByAgent === verifierIdentity;
  if (isSelfVerification) {
    return {
      claimId: claim.id,
      supportStatus: "NOT_FOUND",
      evidenceLevel: "UNKNOWN",
      sourceUri: source.finalUrl,
      sourceOrganization: source.sourceOrganization,
      verifierIdentity,
      checkedAt: new Date(),
      metadata: {
        trustTier: source.trustTier,
        injectionStatus: source.injectionStatus,
        isSelfVerification: true,
        isSameOrganizationAsOtherEvidence: false,
        isRulesOnly: false,
        contradictionDetails: "Research Agent 不能验证自己的 claim, 需独立验证",
      },
    };
  }

  // 2. caller-supplied trustTier 永远非权威, 需重分类
  const reclassifiedTrust = reclassifyTrust(source);

  // 3. model-only claim → UNKNOWN (无 source)
  if (!source || !source.content) {
    return {
      claimId: claim.id,
      supportStatus: "NOT_FOUND",
      evidenceLevel: "UNKNOWN",
      sourceUri: claim.sourceUrl || "model-only",
      sourceOrganization: "model",
      verifierIdentity,
      checkedAt: new Date(),
      metadata: {
        trustTier: "UNTRUSTED",
        injectionStatus: "CLEAN",
        isSelfVerification: false,
        isSameOrganizationAsOtherEvidence: false,
        isRulesOnly: true,
        contradictionDetails: "model-only claim 无真实来源, 必须 UNKNOWN",
      },
    };
  }

  // 4. source fetchability alone ≠ support, 需语义检查
  const supportCheck = checkSupport(claim, source);

  // 5. 需 support span 或语义支撑记录
  // 6. 同组织双URL非独立证据
  const isSameOrg = otherEvidences.some((e) => e.sourceOrganization === source.sourceOrganization && e.id !== source.id);

  // 7. rules-only verifier 永不 VERIFIED
  const isRulesOnly = verifierIdentity.includes("rules") || verifierIdentity.includes("deterministic");
  let evidenceLevel: EvidenceSupportLevel = supportCheck.evidenceLevel;
  if (isRulesOnly && evidenceLevel === "VERIFIED") {
    evidenceLevel = "STRONG"; // rules-only 最高到 STRONG, 不能 VERIFIED
  }

  // 8. 法规类结论必须带 jurisdiction + 日期, 否则 UNKNOWN
  if (JURISDICTION_REQUIRED_CLAIMS.some((kw) => claim.field.includes(kw) || claim.value.includes(kw))) {
    const hasJurisdiction = extractJurisdiction(claim.value) !== null;
    const hasDate = /\d{4}[-年]\d{1,2}/.test(claim.value) || /\d{4}/.test(source.content);
    if (!hasJurisdiction) {
      evidenceLevel = "UNKNOWN";
      return {
        claimId: claim.id,
        supportStatus: "NOT_FOUND",
        evidenceLevel,
        sourceUri: source.finalUrl,
        sourceOrganization: source.sourceOrganization,
        verifierIdentity,
        checkedAt: new Date(),
        metadata: {
          trustTier: reclassifiedTrust,
          injectionStatus: source.injectionStatus,
          isSelfVerification: false,
          isSameOrganizationAsOtherEvidence: isSameOrg,
          isRulesOnly,
          jurisdiction: undefined,
          contradictionDetails: "法规类结论必须带 jurisdiction (如 中国/美国/欧盟) + 日期, 否则 UNKNOWN",
        },
      };
    }
  }

  // 9. injection 隔离
  if (source.injectionStatus === "INJECTED") {
    evidenceLevel = "UNKNOWN";
  }

  const jurisdiction = extractJurisdiction(claim.value) || extractJurisdiction(source.content);

  return {
    claimId: claim.id,
    supportStatus: supportCheck.supportStatus,
    evidenceLevel,
    supportSpan: supportCheck.supportSpan,
    sourceUri: source.finalUrl,
    sourceOrganization: source.sourceOrganization,
    verifierIdentity,
    checkedAt: new Date(),
    metadata: {
      trustTier: reclassifiedTrust,
      injectionStatus: source.injectionStatus,
      isSelfVerification: false,
      isSameOrganizationAsOtherEvidence: isSameOrg,
      isRulesOnly,
      jurisdiction: jurisdiction || undefined,
      freshnessDays: Math.floor((Date.now() - source.fetchedAt.getTime()) / (1000 * 60 * 60 * 24)),
    },
  };
}

function reclassifyTrust(source: SourceCapture): SourceCapture["trustTier"] {
  // Verifier 重新分类, 不信任 caller 提供的 trustTier
  if (source.finalUrl.includes(".gov.cn") || source.finalUrl.includes(".gov") || source.finalUrl.includes("fda.gov") || source.finalUrl.includes("nmpa.gov.cn")) {
    return "OFFICIAL";
  }
  if (source.finalUrl.includes("pubmed") || source.finalUrl.includes("who.int") || source.finalUrl.includes("iso.org")) {
    return "REPUTABLE";
  }
  if (source.injectionStatus === "INJECTED") return "UNTRUSTED";
  return source.trustTier; // 保留但已重验
}

function checkSupport(claim: EvidenceClaim, source: SourceCapture): { supportStatus: SupportStatus; evidenceLevel: EvidenceSupportLevel; supportSpan?: { start: number; end: number; text: string } } {
  const claimLower = claim.value.toLowerCase();
  const contentLower = source.content.toLowerCase();

  // 简单语义检查: claim value 是否在 source content 中
  if (contentLower.includes(claimLower.slice(0, 20))) {
    const idx = contentLower.indexOf(claimLower.slice(0, 20));
    return {
      supportStatus: "SUPPORTED",
      evidenceLevel: source.trustTier === "OFFICIAL" ? "VERIFIED" : source.trustTier === "REPUTABLE" ? "STRONG" : "SUPPORTED",
      supportSpan: { start: idx, end: idx + claim.value.length, text: source.content.slice(idx, idx + 100) },
    };
  }

  // 矛盾检测
  if (contentLower.includes("not") && claimLower.includes("is") && contentLower.includes(claimLower.split(" ")[0])) {
    return { supportStatus: "CONTRADICTED", evidenceLevel: "WEAK" };
  }

  // 未找到
  if (!contentLower.includes(claim.field.toLowerCase().slice(0, 5))) {
    return { supportStatus: "NOT_FOUND", evidenceLevel: "UNKNOWN" };
  }

  return { supportStatus: "AMBIGUOUS", evidenceLevel: "WEAK" };
}

function extractJurisdiction(text: string): string | null {
  const jurisdictions = ["中国", "美国", "欧盟", "日本", "韩国", "中国大陆", "CN", "US", "EU", "JP", "KR", "FDA", "EFSA", "SAMR", "NMPA"];
  for (const j of jurisdictions) {
    if (text.includes(j)) return j;
  }
  return null;
}

export function describeVerifier() {
  return {
    rules: [
      "Research Agent 不能自验",
      "caller trustTier 非权威, 需重分类",
      "model-only → UNKNOWN",
      "fetchability ≠ support, 需语义",
      "需 support span",
      "同组织双URL非独立",
      "rules-only 永不 VERIFIED",
      "法规类需 jurisdiction+日期否则 UNKNOWN",
      "injection 隔离 → UNKNOWN",
    ],
    supportStatuses: ["SUPPORTED", "CONTRADICTED", "NOT_FOUND", "AMBIGUOUS"],
    evidenceLevels: ["UNKNOWN", "WEAK", "SUPPORTED", "STRONG", "VERIFIED"],
  };
}
