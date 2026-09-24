import { classifySourceUrl } from "./source-trust";

export type EvidenceLevel = "UNKNOWN" | "WEAK" | "SUPPORTED" | "STRONG" | "VERIFIED";
export type SupportStatus = "SUPPORTED" | "CONTRADICTED" | "NOT_FOUND" | "AMBIGUOUS";

export interface VerifierClaim {
  claim: string;
  claimKind?: string;
}

export interface VerifierSource {
  evidenceId: string;
  sourceCaptureId?: string | null;
  sourceUri: string;
  httpStatus: number;
  rawContentPreview: string | null;
  quarantined?: boolean;
}

export interface SourceAssessment {
  evidenceId: string;
  sourceCaptureId: string | null;
  sourceUri: string;
  sourceOrganization: string | null;
  trustTier: string;
  supportStatus: SupportStatus;
  supportSpan: string | null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function exactSupportSpan(claim: string, source: string): string | null {
  const target = normalizeText(claim);
  const body = normalizeText(source);
  if (!target || target.length < 12 || !body) return null;
  const index = body.indexOf(target);
  if (index < 0) return null;
  const start = Math.max(0, index - 120);
  const end = Math.min(body.length, index + target.length + 120);
  return body.slice(start, end);
}

export class IndependentEvidenceVerifier {
  constructor(public readonly identity = "independent-verifier/v1") {}

  verifyClaim(claim: VerifierClaim, sources: VerifierSource[]) {
    const assessments: SourceAssessment[] = [];

    for (const source of sources) {
      const classification = classifySourceUrl(source.sourceUri);
      if (!["OFFICIAL", "PRIMARY", "REPUTABLE"].includes(classification.trustTier)) continue;
      if (source.httpStatus < 200 || source.httpStatus >= 300) continue;
      if (source.quarantined) continue;

      const supportSpan = exactSupportSpan(claim.claim, source.rawContentPreview ?? "");
      assessments.push({
        evidenceId: source.evidenceId,
        sourceCaptureId: source.sourceCaptureId ?? null,
        sourceUri: source.sourceUri,
        sourceOrganization: classification.organizationId,
        trustTier: classification.trustTier,
        supportStatus: supportSpan ? "SUPPORTED" : "NOT_FOUND",
        supportSpan,
      });
    }

    const supported = assessments.filter((row) => row.supportStatus === "SUPPORTED");
    const strongSources = supported.filter((row) =>
      row.trustTier === "OFFICIAL" || row.trustTier === "PRIMARY"
    );
    const reputable = supported.filter((row) => row.trustTier === "REPUTABLE");
    const organizations = new Set(strongSources.map((row) => row.sourceOrganization).filter(Boolean));

    let evidenceLevel: EvidenceLevel = "UNKNOWN";
    if (strongSources.length >= 2 && organizations.size >= 2) evidenceLevel = "STRONG";
    else if (strongSources.length >= 1) evidenceLevel = "SUPPORTED";
    else if (reputable.length >= 1) evidenceLevel = "WEAK";

    // Rules-only verification intentionally never emits VERIFIED.
    return {
      claim: claim.claim,
      claimKind: claim.claimKind ?? "FACT",
      evidenceLevel,
      verifierIdentity: this.identity,
      checkedAt: new Date().toISOString(),
      assessments,
    };
  }
}
