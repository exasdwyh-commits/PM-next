-- Evaluation Harness & Experience Loop persistence

CREATE TYPE "EvaluationSuiteStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "EvaluationRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "EvaluationEvaluatorKind" AS ENUM ('CODE', 'LLM_JUDGE', 'HUMAN', 'OUTCOME');
CREATE TYPE "FrozenPredictionVerdict" AS ENUM ('BLOCKED', 'NEEDS_EVIDENCE', 'DEPRIORITIZE', 'VALIDATE', 'PRIORITIZE_FOR_VALIDATION');
CREATE TYPE "ProductValidationOutcomeStatus" AS ENUM ('SUCCESS', 'FAILURE', 'INCONCLUSIVE', 'NOT_RUN');
CREATE TYPE "BacktestAlignmentStatus" AS ENUM ('ALIGNED_SUCCESS', 'ALIGNED_FAILURE', 'FALSE_POSITIVE', 'FALSE_NEGATIVE', 'ABSTAINED', 'INCONCLUSIVE');
CREATE TYPE "ExperienceLessonStatus" AS ENUM ('CANDIDATE', 'APPROVED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "EvaluationSuite" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "EvaluationSuiteStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvaluationSuite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvaluationCase" (
  "id" TEXT NOT NULL,
  "suiteId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "inputJson" JSONB NOT NULL,
  "expectedJson" JSONB NOT NULL,
  "tags" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvaluationRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "suiteId" TEXT,
  "triggerType" TEXT NOT NULL DEFAULT 'MANUAL',
  "status" "EvaluationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "subjectType" TEXT,
  "subjectId" TEXT,
  "modelProfileId" TEXT,
  "modelPolicyKey" TEXT,
  "promptVersion" TEXT,
  "ruleVersion" TEXT,
  "metricsJson" JSONB,
  "errorReason" TEXT,
  "startedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvaluationCaseResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "caseId" TEXT,
  "caseKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "evaluatorKind" "EvaluationEvaluatorKind" NOT NULL DEFAULT 'CODE',
  "passed" BOOLEAN NOT NULL,
  "criticalFailures" INTEGER NOT NULL DEFAULT 0,
  "outputJson" JSONB,
  "checksJson" JSONB NOT NULL,
  "scoreJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvaluationCaseResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FrozenPrediction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productVersionId" TEXT NOT NULL,
  "productVersionFingerprint" TEXT NOT NULL,
  "channelRouteId" TEXT,
  "channelRouteFingerprint" TEXT,
  "segmentKey" TEXT NOT NULL DEFAULT 'global',
  "assessmentRuleVersion" TEXT NOT NULL,
  "verdict" "FrozenPredictionVerdict" NOT NULL,
  "diagnosticIndex" DOUBLE PRECISION,
  "coverageRatio" DOUBLE PRECISION NOT NULL,
  "verifiedCoverageRatio" DOUBLE PRECISION NOT NULL,
  "dimensionSnapshot" JSONB NOT NULL,
  "gateSnapshot" JSONB NOT NULL,
  "evidenceFingerprint" TEXT,
  "modelPolicyKey" TEXT,
  "modelProfileId" TEXT,
  "promptVersion" TEXT,
  "createdById" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FrozenPrediction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductOutcome" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "frozenPredictionId" TEXT NOT NULL,
  "observationKey" TEXT NOT NULL,
  "outcome" "ProductValidationOutcomeStatus" NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "verifiedById" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "channelAccepted" BOOLEAN,
  "launched" BOOLEAN,
  "actualContributionMarginRate" DOUBLE PRECISION,
  "actualReturnRate" DOUBLE PRECISION,
  "repeatPurchaseRate" DOUBLE PRECISION,
  "observationDays" INTEGER,
  "notes" JSONB,
  "backtestAlignment" "BacktestAlignmentStatus" NOT NULL,
  "backtestComparable" BOOLEAN NOT NULL DEFAULT true,
  "backtestReason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExperienceLesson" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "segmentKey" TEXT NOT NULL,
  "targetType" TEXT,
  "targetKey" TEXT,
  "statement" TEXT NOT NULL,
  "supportCount" INTEGER NOT NULL,
  "contradictionCount" INTEGER NOT NULL,
  "sampleSize" INTEGER NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "status" "ExperienceLessonStatus" NOT NULL DEFAULT 'CANDIDATE',
  "readyForReview" BOOLEAN NOT NULL DEFAULT false,
  "limitations" JSONB NOT NULL,
  "proposedChange" JSONB,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExperienceLesson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationSuite_organizationId_key_version_key" ON "EvaluationSuite"("organizationId", "key", "version");
CREATE INDEX "EvaluationSuite_organizationId_status_idx" ON "EvaluationSuite"("organizationId", "status");

CREATE UNIQUE INDEX "EvaluationCase_suiteId_key_key" ON "EvaluationCase"("suiteId", "key");
CREATE INDEX "EvaluationCase_suiteId_active_idx" ON "EvaluationCase"("suiteId", "active");

CREATE INDEX "EvaluationRun_organizationId_status_idx" ON "EvaluationRun"("organizationId", "status");
CREATE INDEX "EvaluationRun_suiteId_idx" ON "EvaluationRun"("suiteId");
CREATE INDEX "EvaluationRun_subjectType_subjectId_idx" ON "EvaluationRun"("subjectType", "subjectId");
CREATE INDEX "EvaluationRun_modelProfileId_idx" ON "EvaluationRun"("modelProfileId");
CREATE INDEX "EvaluationRun_modelPolicyKey_idx" ON "EvaluationRun"("modelPolicyKey");

CREATE INDEX "EvaluationCaseResult_runId_idx" ON "EvaluationCaseResult"("runId");
CREATE INDEX "EvaluationCaseResult_caseId_idx" ON "EvaluationCaseResult"("caseId");
CREATE INDEX "EvaluationCaseResult_passed_idx" ON "EvaluationCaseResult"("passed");

CREATE INDEX "FrozenPrediction_organizationId_productId_idx" ON "FrozenPrediction"("organizationId", "productId");
CREATE INDEX "FrozenPrediction_productVersionId_idx" ON "FrozenPrediction"("productVersionId");
CREATE INDEX "FrozenPrediction_segmentKey_idx" ON "FrozenPrediction"("segmentKey");
CREATE INDEX "FrozenPrediction_verdict_idx" ON "FrozenPrediction"("verdict");
CREATE INDEX "FrozenPrediction_evaluatedAt_idx" ON "FrozenPrediction"("evaluatedAt");

CREATE UNIQUE INDEX "ProductOutcome_frozenPredictionId_observationKey_key" ON "ProductOutcome"("frozenPredictionId", "observationKey");
CREATE INDEX "ProductOutcome_organizationId_outcome_idx" ON "ProductOutcome"("organizationId", "outcome");
CREATE INDEX "ProductOutcome_observationKey_idx" ON "ProductOutcome"("observationKey");
CREATE INDEX "ProductOutcome_backtestAlignment_idx" ON "ProductOutcome"("backtestAlignment");

CREATE UNIQUE INDEX "ExperienceLesson_organizationId_key_version_key" ON "ExperienceLesson"("organizationId", "key", "version");
CREATE INDEX "ExperienceLesson_organizationId_status_idx" ON "ExperienceLesson"("organizationId", "status");
CREATE INDEX "ExperienceLesson_segmentKey_targetType_targetKey_idx" ON "ExperienceLesson"("segmentKey", "targetType", "targetKey");
CREATE INDEX "ExperienceLesson_readyForReview_idx" ON "ExperienceLesson"("readyForReview");

ALTER TABLE "EvaluationSuite" ADD CONSTRAINT "EvaluationSuite_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvaluationSuite" ADD CONSTRAINT "EvaluationSuite_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_suiteId_fkey"
  FOREIGN KEY ("suiteId") REFERENCES "EvaluationSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_suiteId_fkey"
  FOREIGN KEY ("suiteId") REFERENCES "EvaluationSuite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_startedById_fkey"
  FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvaluationCaseResult" ADD CONSTRAINT "EvaluationCaseResult_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "EvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvaluationCaseResult" ADD CONSTRAINT "EvaluationCaseResult_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "EvaluationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FrozenPrediction" ADD CONSTRAINT "FrozenPrediction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FrozenPrediction" ADD CONSTRAINT "FrozenPrediction_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FrozenPrediction" ADD CONSTRAINT "FrozenPrediction_productVersionId_fkey"
  FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrozenPrediction" ADD CONSTRAINT "FrozenPrediction_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductOutcome" ADD CONSTRAINT "ProductOutcome_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOutcome" ADD CONSTRAINT "ProductOutcome_frozenPredictionId_fkey"
  FOREIGN KEY ("frozenPredictionId") REFERENCES "FrozenPrediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOutcome" ADD CONSTRAINT "ProductOutcome_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExperienceLesson" ADD CONSTRAINT "ExperienceLesson_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperienceLesson" ADD CONSTRAINT "ExperienceLesson_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fail closed on malformed evaluation data.
ALTER TABLE "EvaluationSuite" ADD CONSTRAINT "EvaluationSuite_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "EvaluationCaseResult" ADD CONSTRAINT "EvaluationCaseResult_criticalFailures_check"
  CHECK ("criticalFailures" >= 0);

ALTER TABLE "FrozenPrediction" ADD CONSTRAINT "FrozenPrediction_coverage_check"
  CHECK ("coverageRatio" BETWEEN 0 AND 1 AND "verifiedCoverageRatio" BETWEEN 0 AND 1);
ALTER TABLE "FrozenPrediction" ADD CONSTRAINT "FrozenPrediction_diagnostic_check"
  CHECK ("diagnosticIndex" IS NULL OR ("diagnosticIndex" BETWEEN 0 AND 100));

ALTER TABLE "ProductOutcome" ADD CONSTRAINT "ProductOutcome_evidenceRefs_check"
  CHECK (jsonb_typeof("evidenceRefs") = 'array' AND jsonb_array_length("evidenceRefs") > 0);
ALTER TABLE "ProductOutcome" ADD CONSTRAINT "ProductOutcome_rate_check"
  CHECK (
    ("actualReturnRate" IS NULL OR "actualReturnRate" BETWEEN 0 AND 1)
    AND ("repeatPurchaseRate" IS NULL OR "repeatPurchaseRate" BETWEEN 0 AND 1)
  );
ALTER TABLE "ProductOutcome" ADD CONSTRAINT "ProductOutcome_observationDays_check"
  CHECK ("observationDays" IS NULL OR "observationDays" >= 0);

ALTER TABLE "ExperienceLesson" ADD CONSTRAINT "ExperienceLesson_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "ExperienceLesson" ADD CONSTRAINT "ExperienceLesson_counts_check"
  CHECK (
    "supportCount" >= 0
    AND "contradictionCount" >= 0
    AND "sampleSize" >= 0
    AND "supportCount" + "contradictionCount" <= "sampleSize"
  );
