-- Durable readable result returned by an AgentRun.
ALTER TABLE "AgentRun"
  ADD COLUMN IF NOT EXISTS "outputSummary" TEXT;
