-- Decision Intelligence provenance and workforce trigger linkage

CREATE TYPE "DecisionRunEngineKind" AS ENUM ('RULES', 'MODEL');
CREATE TYPE "DecisionRunRiskClass" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "DecisionRunPolicyAction" AS ENUM ('AUTO', 'ESCALATE_AGENT', 'ESCALATE_HUMAN', 'BLOCK');

CREATE TABLE "DecisionRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "decisionKey" TEXT NOT NULL,
  "specVersion" TEXT NOT NULL,
  "outputType" TEXT NOT NULL,
  "riskClass" "DecisionRunRiskClass" NOT NULL,
  "engine" "DecisionRunEngineKind" NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "criteriaSnapshot" JSONB,
  "criteriaHash" TEXT,
  "contextRefs" JSONB NOT NULL,
  "language" TEXT,
  "resultJson" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "distribution" JSONB,
  "reasonCodes" JSONB NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "calibrated" BOOLEAN NOT NULL DEFAULT false,
  "calibrationProfile" TEXT,
  "benchmarkProfile" TEXT,
  "policyAction" "DecisionRunPolicyAction" NOT NULL,
  "policyReasons" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AgentTask"
  ADD COLUMN "triggerDecisionRunId" TEXT;

CREATE INDEX "DecisionRun_organizationId_decisionKey_createdAt_idx"
  ON "DecisionRun"("organizationId", "decisionKey", "createdAt");
CREATE INDEX "DecisionRun_organizationId_policyAction_idx"
  ON "DecisionRun"("organizationId", "policyAction");
CREATE INDEX "DecisionRun_decisionKey_specVersion_idx"
  ON "DecisionRun"("decisionKey", "specVersion");
CREATE INDEX "DecisionRun_engine_engineVersion_idx"
  ON "DecisionRun"("engine", "engineVersion");
CREATE INDEX "DecisionRun_inputHash_idx"
  ON "DecisionRun"("inputHash");

CREATE INDEX "AgentTask_triggerDecisionRunId_idx"
  ON "AgentTask"("triggerDecisionRunId");

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentTask"
  ADD CONSTRAINT "AgentTask_triggerDecisionRunId_fkey"
  FOREIGN KEY ("triggerDecisionRunId") REFERENCES "DecisionRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_confidence_check"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_latency_check"
  CHECK ("latencyMs" >= 0);

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_contextRefs_check"
  CHECK (jsonb_typeof("contextRefs") = 'array');

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_reasonCodes_check"
  CHECK (jsonb_typeof("reasonCodes") = 'array');

ALTER TABLE "DecisionRun"
  ADD CONSTRAINT "DecisionRun_policyReasons_check"
  CHECK (jsonb_typeof("policyReasons") = 'array');
