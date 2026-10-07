ALTER TABLE "AgentRun" ADD COLUMN "clientMessageId" TEXT, ADD COLUMN "inputMessageId" TEXT, ADD COLUMN "executionToken" TEXT;
CREATE UNIQUE INDEX "AgentRun_inputMessageId_key" ON "AgentRun"("inputMessageId");
CREATE UNIQUE INDEX "AgentRun_conversationId_clientMessageId_key" ON "AgentRun"("conversationId", "clientMessageId");
ALTER TABLE "PmWorkerHeartbeat" ADD COLUMN "organizationId" TEXT, ADD COLUMN "scopeKnown" BOOLEAN NOT NULL DEFAULT false;
