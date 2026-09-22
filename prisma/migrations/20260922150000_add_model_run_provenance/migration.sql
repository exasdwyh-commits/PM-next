-- Model Gateway Runtime V2
-- Durable provenance for every gateway-backed model execution.
-- Prompts and API credentials are intentionally not persisted here.

CREATE TYPE "ModelRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "ModelRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentRunId" TEXT,
  "taskClass" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "profileKey" TEXT,
  "provider" TEXT,
  "modelId" TEXT,
  "status" "ModelRunStatus" NOT NULL DEFAULT 'RUNNING',
  "attempts" JSONB,
  "routingSkips" JSONB,
  "usageJson" JSONB,
  "requestMeta" JSONB,
  "errorReason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModelRun_organizationId_createdAt_idx"
  ON "ModelRun"("organizationId", "createdAt");
CREATE INDEX "ModelRun_agentRunId_idx"
  ON "ModelRun"("agentRunId");
CREATE INDEX "ModelRun_policyKey_policyVersion_idx"
  ON "ModelRun"("policyKey", "policyVersion");
CREATE INDEX "ModelRun_profileKey_idx"
  ON "ModelRun"("profileKey");
CREATE INDEX "ModelRun_status_idx"
  ON "ModelRun"("status");

ALTER TABLE "ModelRun"
  ADD CONSTRAINT "ModelRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelRun"
  ADD CONSTRAINT "ModelRun_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelRun"
  ADD CONSTRAINT "ModelRun_durationMs_check"
  CHECK ("durationMs" IS NULL OR "durationMs" >= 0);
