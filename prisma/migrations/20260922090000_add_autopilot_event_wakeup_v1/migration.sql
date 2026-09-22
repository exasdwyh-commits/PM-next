-- Autopilot / Event Wakeup V1

CREATE TYPE "AutopilotStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AutopilotActionKind" AS ENUM ('WAKE_PM');
CREATE TYPE "AutopilotEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'TRIGGERED', 'SUPPRESSED', 'WAITING_HUMAN', 'FAILED');

CREATE TABLE "Autopilot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "decisionKey" TEXT NOT NULL,
  "decisionSpecVersion" TEXT NOT NULL,
  "actionKind" "AutopilotActionKind" NOT NULL,
  "status" "AutopilotStatus" NOT NULL DEFAULT 'ACTIVE',
  "cooldownSeconds" INTEGER NOT NULL DEFAULT 300,
  "failureThreshold" INTEGER NOT NULL DEFAULT 3,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "pausedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Autopilot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopilotEventReceipt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "autopilotId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "payloadHash" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "contextRefs" JSONB NOT NULL,
  "taskGoal" TEXT NOT NULL,
  "status" "AutopilotEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "decisionRunId" TEXT,
  "agentTaskId" TEXT,
  "suppressionReason" TEXT,
  "errorReason" TEXT,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutopilotEventReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Autopilot_organizationId_key_key"
  ON "Autopilot"("organizationId", "key");
CREATE INDEX "Autopilot_organizationId_status_idx"
  ON "Autopilot"("organizationId", "status");
CREATE INDEX "Autopilot_pausedUntil_idx"
  ON "Autopilot"("pausedUntil");

CREATE UNIQUE INDEX "AutopilotEventReceipt_agentTaskId_key"
  ON "AutopilotEventReceipt"("agentTaskId");
CREATE UNIQUE INDEX "AutopilotEventReceipt_autopilotId_eventKey_key"
  ON "AutopilotEventReceipt"("autopilotId", "eventKey");
CREATE INDEX "AutopilotEventReceipt_organizationId_status_idx"
  ON "AutopilotEventReceipt"("organizationId", "status");
CREATE INDEX "AutopilotEventReceipt_autopilotId_status_idx"
  ON "AutopilotEventReceipt"("autopilotId", "status");
CREATE INDEX "AutopilotEventReceipt_decisionRunId_idx"
  ON "AutopilotEventReceipt"("decisionRunId");
CREATE INDEX "AutopilotEventReceipt_sourceType_sourceId_idx"
  ON "AutopilotEventReceipt"("sourceType", "sourceId");
CREATE INDEX "AutopilotEventReceipt_leaseExpiresAt_idx"
  ON "AutopilotEventReceipt"("leaseExpiresAt");
CREATE INDEX "AutopilotEventReceipt_createdAt_idx"
  ON "AutopilotEventReceipt"("createdAt");

ALTER TABLE "Autopilot"
  ADD CONSTRAINT "Autopilot_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Autopilot"
  ADD CONSTRAINT "Autopilot_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopilotEventReceipt"
  ADD CONSTRAINT "AutopilotEventReceipt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventReceipt"
  ADD CONSTRAINT "AutopilotEventReceipt_autopilotId_fkey"
  FOREIGN KEY ("autopilotId") REFERENCES "Autopilot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventReceipt"
  ADD CONSTRAINT "AutopilotEventReceipt_decisionRunId_fkey"
  FOREIGN KEY ("decisionRunId") REFERENCES "DecisionRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventReceipt"
  ADD CONSTRAINT "AutopilotEventReceipt_agentTaskId_fkey"
  FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Autopilot"
  ADD CONSTRAINT "Autopilot_cooldownSeconds_check"
  CHECK ("cooldownSeconds" >= 0);
ALTER TABLE "Autopilot"
  ADD CONSTRAINT "Autopilot_failureThreshold_check"
  CHECK ("failureThreshold" >= 1);
ALTER TABLE "Autopilot"
  ADD CONSTRAINT "Autopilot_consecutiveFailures_check"
  CHECK ("consecutiveFailures" >= 0);

ALTER TABLE "AutopilotEventReceipt"
  ADD CONSTRAINT "AutopilotEventReceipt_attempts_check"
  CHECK ("attempt" >= 0 AND "maxAttempts" >= 1 AND "attempt" <= "maxAttempts");
ALTER TABLE "AutopilotEventReceipt"
  ADD CONSTRAINT "AutopilotEventReceipt_contextRefs_check"
  CHECK (jsonb_typeof("contextRefs") = 'array');
