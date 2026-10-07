ALTER TABLE "ModelRun"
ADD COLUMN "logicalCallId" TEXT,
ADD COLUMN "transportKnown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "transportStartedAt" TIMESTAMP(3),
ADD COLUMN "budgetScopeKey" TEXT,
ADD COLUMN "budgetMaxAttempts" INTEGER,
ADD COLUMN "budgetDeadlineAt" TIMESTAMP(3);
CREATE INDEX "ModelRun_logicalCallId_idx" ON "ModelRun"("logicalCallId");
CREATE INDEX "ModelRun_budgetScopeKey_idx" ON "ModelRun"("budgetScopeKey");
