-- Formal G3 launch authorization
ALTER TYPE "GateType" ADD VALUE 'LAUNCH_GATE';

ALTER TABLE "DecisionPacket"
  ADD COLUMN "launchPlanId" TEXT,
  ADD COLUMN "launchPlanHash" TEXT;

ALTER TABLE "LaunchPlan"
  ADD COLUMN "governanceRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "formalG3PacketId" TEXT,
  ADD COLUMN "formalG3ApprovedAt" TIMESTAMP(3);

CREATE INDEX "DecisionPacket_launchPlanId_idx" ON "DecisionPacket"("launchPlanId");
CREATE UNIQUE INDEX "LaunchPlan_formalG3PacketId_key" ON "LaunchPlan"("formalG3PacketId");

ALTER TABLE "DecisionPacket"
  ADD CONSTRAINT "DecisionPacket_launchPlanId_fkey"
  FOREIGN KEY ("launchPlanId") REFERENCES "LaunchPlan"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaunchPlan"
  ADD CONSTRAINT "LaunchPlan_formalG3PacketId_fkey"
  FOREIGN KEY ("formalG3PacketId") REFERENCES "DecisionPacket"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
