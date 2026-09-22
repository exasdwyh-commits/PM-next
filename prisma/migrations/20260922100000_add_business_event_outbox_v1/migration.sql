-- Transactional business-event outbox + Red Team Autopilot action

ALTER TYPE "AutopilotActionKind" ADD VALUE IF NOT EXISTS 'WAKE_RED_TEAM';

CREATE TYPE "BusinessEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DISPATCHED', 'FAILED');

CREATE TABLE "BusinessEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "contextRefs" JSONB NOT NULL,
  "status" "BusinessEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "autopilotReceiptId" TEXT,
  "createdById" TEXT,
  "dispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessEvent_autopilotReceiptId_key"
  ON "BusinessEvent"("autopilotReceiptId");
CREATE UNIQUE INDEX "BusinessEvent_organizationId_eventKey_key"
  ON "BusinessEvent"("organizationId", "eventKey");
CREATE INDEX "BusinessEvent_organizationId_status_idx"
  ON "BusinessEvent"("organizationId", "status");
CREATE INDEX "BusinessEvent_eventType_createdAt_idx"
  ON "BusinessEvent"("eventType", "createdAt");
CREATE INDEX "BusinessEvent_aggregateType_aggregateId_idx"
  ON "BusinessEvent"("aggregateType", "aggregateId");
CREATE INDEX "BusinessEvent_leaseExpiresAt_idx"
  ON "BusinessEvent"("leaseExpiresAt");
CREATE INDEX "BusinessEvent_createdAt_idx"
  ON "BusinessEvent"("createdAt");

ALTER TABLE "BusinessEvent"
  ADD CONSTRAINT "BusinessEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessEvent"
  ADD CONSTRAINT "BusinessEvent_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessEvent"
  ADD CONSTRAINT "BusinessEvent_autopilotReceiptId_fkey"
  FOREIGN KEY ("autopilotReceiptId") REFERENCES "AutopilotEventReceipt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessEvent"
  ADD CONSTRAINT "BusinessEvent_attempts_check"
  CHECK ("attempt" >= 0 AND "maxAttempts" >= 1 AND "attempt" <= "maxAttempts");

ALTER TABLE "BusinessEvent"
  ADD CONSTRAINT "BusinessEvent_contextRefs_check"
  CHECK (jsonb_typeof("contextRefs") = 'array');
