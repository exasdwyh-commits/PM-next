-- Channel Route & Product Potential Persistence V1
-- Same product version can carry multiple channel-specific routes.
-- Rules and assessments are immutable/versioned evidence-bearing snapshots.

CREATE TYPE "ChannelRuleRecordStatus" AS ENUM ('ASSUMED', 'CONFIRMED', 'SUPERSEDED');
CREATE TYPE "ChannelSpecRouteStatus" AS ENUM (
  'DRAFT',
  'BLOCKED',
  'VALIDATION_READY',
  'VALIDATING',
  'CONFIRMED',
  'REJECTED',
  'SUPERSEDED'
);
CREATE TYPE "ProductPotentialVerdict" AS ENUM (
  'BLOCKED',
  'NEEDS_EVIDENCE',
  'DEPRIORITIZE',
  'VALIDATE',
  'PRIORITIZE_FOR_VALIDATION'
);
CREATE TYPE "PotentialConfidenceBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "ChannelRuleProfileRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "ChannelRuleRecordStatus" NOT NULL DEFAULT 'ASSUMED',
  "sourceRefs" JSONB NOT NULL,
  "minRetailPrice" DECIMAL(12,2),
  "maxRetailPrice" DECIMAL(12,2),
  "minBundleQuantity" INTEGER,
  "maxBundleQuantity" INTEGER,
  "allowedUnitLabels" JSONB,
  "commissionRate" DECIMAL(7,3) NOT NULL,
  "platformFeeRate" DECIMAL(7,3) NOT NULL,
  "marketingRate" DECIMAL(7,3) NOT NULL,
  "managementFeeRate" DECIMAL(7,3) NOT NULL,
  "returnRate" DECIMAL(7,3) NOT NULL,
  "returnHandlingFeeRate" DECIMAL(7,3) NOT NULL,
  "targetContributionMarginRate" DECIMAL(7,3) NOT NULL,
  "constraints" JSONB,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "supersedesId" TEXT,
  "createdById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelRuleProfileRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelSpecRoute" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productVersionId" TEXT NOT NULL,
  "channelRuleProfileId" TEXT NOT NULL,
  "routeKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "name" TEXT NOT NULL,
  "status" "ChannelSpecRouteStatus" NOT NULL DEFAULT 'DRAFT',
  "retailPrice" DECIMAL(12,2) NOT NULL,
  "bundleQuantity" INTEGER NOT NULL,
  "unitLabel" TEXT NOT NULL,
  "packageSpec" TEXT,
  "productCostPerUnit" DECIMAL(12,2) NOT NULL,
  "packagingCostPerOrder" DECIMAL(12,2) NOT NULL,
  "freightCostPerOrder" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "ruleStatusSnapshot" "ChannelRuleRecordStatus" NOT NULL,
  "ruleVersionSnapshot" TEXT NOT NULL,
  "evaluationSnapshot" JSONB NOT NULL,
  "feasible" BOOLEAN NOT NULL,
  "blockerCount" INTEGER NOT NULL DEFAULT 0,
  "contributionMarginRate" DECIMAL(9,3) NOT NULL,
  "requiredMaxProductCostPerUnit" DECIMAL(12,2),
  "supersedesId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelSpecRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PotentialAssessmentRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productVersionId" TEXT NOT NULL,
  "channelRouteId" TEXT,
  "ruleVersion" TEXT NOT NULL,
  "dimensionSnapshot" JSONB NOT NULL,
  "gateSnapshot" JSONB NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "marketValidationVerified" BOOLEAN NOT NULL DEFAULT false,
  "verdict" "ProductPotentialVerdict" NOT NULL,
  "diagnosticIndex" DECIMAL(7,2),
  "coverageRatio" DECIMAL(7,4) NOT NULL,
  "verifiedCoverageRatio" DECIMAL(7,4) NOT NULL,
  "confidenceBand" "PotentialConfidenceBand" NOT NULL,
  "reasons" JSONB NOT NULL,
  "blockers" JSONB NOT NULL,
  "unknownGates" JSONB NOT NULL,
  "supersedesId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PotentialAssessmentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelRuleProfileRecord_organizationId_channelKey_version_key"
  ON "ChannelRuleProfileRecord"("organizationId", "channelKey", "version");
CREATE INDEX "ChannelRuleProfileRecord_organizationId_channelKey_status_idx"
  ON "ChannelRuleProfileRecord"("organizationId", "channelKey", "status");
CREATE INDEX "ChannelRuleProfileRecord_supersedesId_idx"
  ON "ChannelRuleProfileRecord"("supersedesId");

CREATE UNIQUE INDEX "ChannelSpecRoute_productVersionId_routeKey_revision_key"
  ON "ChannelSpecRoute"("productVersionId", "routeKey", "revision");
CREATE INDEX "ChannelSpecRoute_organizationId_createdAt_idx"
  ON "ChannelSpecRoute"("organizationId", "createdAt");
CREATE INDEX "ChannelSpecRoute_productVersionId_status_idx"
  ON "ChannelSpecRoute"("productVersionId", "status");
CREATE INDEX "ChannelSpecRoute_channelRuleProfileId_idx"
  ON "ChannelSpecRoute"("channelRuleProfileId");
CREATE INDEX "ChannelSpecRoute_supersedesId_idx"
  ON "ChannelSpecRoute"("supersedesId");

CREATE INDEX "PotentialAssessmentRecord_organizationId_createdAt_idx"
  ON "PotentialAssessmentRecord"("organizationId", "createdAt");
CREATE INDEX "PotentialAssessmentRecord_productVersionId_createdAt_idx"
  ON "PotentialAssessmentRecord"("productVersionId", "createdAt");
CREATE INDEX "PotentialAssessmentRecord_channelRouteId_createdAt_idx"
  ON "PotentialAssessmentRecord"("channelRouteId", "createdAt");
CREATE INDEX "PotentialAssessmentRecord_supersedesId_idx"
  ON "PotentialAssessmentRecord"("supersedesId");

ALTER TABLE "ChannelRuleProfileRecord"
  ADD CONSTRAINT "ChannelRuleProfileRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelRuleProfileRecord"
  ADD CONSTRAINT "ChannelRuleProfileRecord_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "ChannelRuleProfileRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChannelSpecRoute"
  ADD CONSTRAINT "ChannelSpecRoute_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelSpecRoute"
  ADD CONSTRAINT "ChannelSpecRoute_productVersionId_fkey"
  FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelSpecRoute"
  ADD CONSTRAINT "ChannelSpecRoute_channelRuleProfileId_fkey"
  FOREIGN KEY ("channelRuleProfileId") REFERENCES "ChannelRuleProfileRecord"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelSpecRoute"
  ADD CONSTRAINT "ChannelSpecRoute_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "ChannelSpecRoute"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PotentialAssessmentRecord"
  ADD CONSTRAINT "PotentialAssessmentRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PotentialAssessmentRecord"
  ADD CONSTRAINT "PotentialAssessmentRecord_productVersionId_fkey"
  FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PotentialAssessmentRecord"
  ADD CONSTRAINT "PotentialAssessmentRecord_channelRouteId_fkey"
  FOREIGN KEY ("channelRouteId") REFERENCES "ChannelSpecRoute"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PotentialAssessmentRecord"
  ADD CONSTRAINT "PotentialAssessmentRecord_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "PotentialAssessmentRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChannelRuleProfileRecord"
  ADD CONSTRAINT "ChannelRuleProfileRecord_price_band_check"
  CHECK (
    ("minRetailPrice" IS NULL OR "minRetailPrice" >= 0)
    AND ("maxRetailPrice" IS NULL OR "maxRetailPrice" >= 0)
    AND ("minRetailPrice" IS NULL OR "maxRetailPrice" IS NULL OR "minRetailPrice" <= "maxRetailPrice")
  );
ALTER TABLE "ChannelRuleProfileRecord"
  ADD CONSTRAINT "ChannelRuleProfileRecord_bundle_band_check"
  CHECK (
    ("minBundleQuantity" IS NULL OR "minBundleQuantity" > 0)
    AND ("maxBundleQuantity" IS NULL OR "maxBundleQuantity" > 0)
    AND ("minBundleQuantity" IS NULL OR "maxBundleQuantity" IS NULL OR "minBundleQuantity" <= "maxBundleQuantity")
  );
ALTER TABLE "ChannelRuleProfileRecord"
  ADD CONSTRAINT "ChannelRuleProfileRecord_rates_check"
  CHECK (
    "commissionRate" BETWEEN 0 AND 100
    AND "platformFeeRate" BETWEEN 0 AND 100
    AND "marketingRate" BETWEEN 0 AND 100
    AND "managementFeeRate" BETWEEN 0 AND 100
    AND "returnRate" BETWEEN 0 AND 100
    AND "returnHandlingFeeRate" BETWEEN 0 AND 100
    AND "targetContributionMarginRate" BETWEEN 0 AND 100
  );
ALTER TABLE "ChannelRuleProfileRecord"
  ADD CONSTRAINT "ChannelRuleProfileRecord_effective_range_check"
  CHECK (
    "effectiveFrom" IS NULL OR "effectiveUntil" IS NULL OR "effectiveFrom" <= "effectiveUntil"
  );

ALTER TABLE "ChannelSpecRoute"
  ADD CONSTRAINT "ChannelSpecRoute_values_check"
  CHECK (
    "retailPrice" > 0
    AND "bundleQuantity" > 0
    AND "productCostPerUnit" >= 0
    AND "packagingCostPerOrder" >= 0
    AND "freightCostPerOrder" >= 0
    AND "blockerCount" >= 0
  );
ALTER TABLE "PotentialAssessmentRecord"
  ADD CONSTRAINT "PotentialAssessmentRecord_ratios_check"
  CHECK (
    "coverageRatio" BETWEEN 0 AND 1
    AND "verifiedCoverageRatio" BETWEEN 0 AND 1
    AND ("diagnosticIndex" IS NULL OR "diagnosticIndex" BETWEEN 0 AND 100)
  );
