ALTER TABLE "AgentTask"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "AgentTask_idempotencyKey_key"
ON "AgentTask"("idempotencyKey");
