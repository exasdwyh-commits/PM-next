-- PM OS fusion core: operational approvals, epistemic evidence and reusable knowledge debt.

ALTER TABLE "Evidence"
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "trustTier" TEXT,
  ADD COLUMN "dataClass" TEXT NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "untrustedInput" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fetchedAt" TIMESTAMP(3),
  ADD COLUMN "sourceOrganization" TEXT,
  ADD COLUMN "injectionStatus" TEXT;

ALTER TABLE "EvidenceClaim"
  ADD COLUMN "evidenceLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "freshness" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "verifierRunId" TEXT;

CREATE TABLE "EvidenceVerification" (
  "id" TEXT NOT NULL,
  "evidenceClaimId" TEXT NOT NULL,
  "verifierIdentity" TEXT NOT NULL,
  "supportStatus" TEXT NOT NULL,
  "supportSpan" TEXT,
  "sourceUri" TEXT,
  "sourceOrganization" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "EvidenceVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvidenceVerification_evidenceClaimId_checkedAt_idx"
  ON "EvidenceVerification"("evidenceClaimId", "checkedAt");
CREATE INDEX "EvidenceVerification_supportStatus_idx"
  ON "EvidenceVerification"("supportStatus");
ALTER TABLE "EvidenceVerification"
  ADD CONSTRAINT "EvidenceVerification_evidenceClaimId_fkey"
  FOREIGN KEY ("evidenceClaimId") REFERENCES "EvidenceClaim"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ApprovalGrant" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "approvedById" TEXT NOT NULL,
  "taskRef" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "actionHash" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "channel" TEXT,
  "signature" TEXT NOT NULL,
  "singleUse" BOOLEAN NOT NULL DEFAULT true,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "usedByRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalGrant_organizationId_validUntil_idx"
  ON "ApprovalGrant"("organizationId", "validUntil");
CREATE INDEX "ApprovalGrant_approvedById_idx"
  ON "ApprovalGrant"("approvedById");
CREATE INDEX "ApprovalGrant_taskRef_capability_idx"
  ON "ApprovalGrant"("taskRef", "capability");
ALTER TABLE "ApprovalGrant"
  ADD CONSTRAINT "ApprovalGrant_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalGrant"
  ADD CONSTRAINT "ApprovalGrant_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "KnowledgeDebt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "normalizedKey" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "importance" TEXT NOT NULL DEFAULT 'MEDIUM',
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "suggestedExpertClass" TEXT,
  "resolvedByEvidenceId" TEXT,
  "relatedDataGapId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "KnowledgeDebt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeDebt_organizationId_normalizedKey_key"
  ON "KnowledgeDebt"("organizationId", "normalizedKey");
CREATE INDEX "KnowledgeDebt_organizationId_status_idx"
  ON "KnowledgeDebt"("organizationId", "status");
CREATE INDEX "KnowledgeDebt_projectId_idx"
  ON "KnowledgeDebt"("projectId");
CREATE INDEX "KnowledgeDebt_lastSeenAt_idx"
  ON "KnowledgeDebt"("lastSeenAt");
ALTER TABLE "KnowledgeDebt"
  ADD CONSTRAINT "KnowledgeDebt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDebt"
  ADD CONSTRAINT "KnowledgeDebt_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
