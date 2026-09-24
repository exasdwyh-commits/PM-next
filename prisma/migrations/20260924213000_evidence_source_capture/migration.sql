-- Durable verifier source captures: caller-supplied raw source text can no longer
-- be treated as independent evidence.

CREATE TABLE "EvidenceSourceCapture" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "sourceUri" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "trustTier" TEXT NOT NULL,
  "sourceOrganization" TEXT,
  "httpStatus" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "rawContentPreview" TEXT NOT NULL,
  "injectionStatus" TEXT NOT NULL,
  "injectionFlags" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "fetcherIdentity" TEXT NOT NULL,
  "remoteAddress" TEXT,
  "contentType" TEXT,
  "redirectCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceSourceCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvidenceSourceCapture_evidenceId_fetchedAt_idx"
  ON "EvidenceSourceCapture"("evidenceId", "fetchedAt");
CREATE INDEX "EvidenceSourceCapture_sourceOrganization_idx"
  ON "EvidenceSourceCapture"("sourceOrganization");
CREATE INDEX "EvidenceSourceCapture_trustTier_idx"
  ON "EvidenceSourceCapture"("trustTier");

ALTER TABLE "EvidenceSourceCapture"
  ADD CONSTRAINT "EvidenceSourceCapture_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvidenceVerification"
  ADD COLUMN "sourceCaptureId" TEXT;

CREATE INDEX "EvidenceVerification_sourceCaptureId_idx"
  ON "EvidenceVerification"("sourceCaptureId");

ALTER TABLE "EvidenceVerification"
  ADD CONSTRAINT "EvidenceVerification_sourceCaptureId_fkey"
  FOREIGN KEY ("sourceCaptureId") REFERENCES "EvidenceSourceCapture"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
