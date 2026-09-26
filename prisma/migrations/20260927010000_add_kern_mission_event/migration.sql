-- Kern Display Layer: append-only mission event stream
CREATE TABLE "KernMissionEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "missionTaskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "nodeKey" TEXT,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KernMissionEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KernMissionEvent_missionTaskId_seq_key" ON "KernMissionEvent"("missionTaskId", "seq");
CREATE INDEX "KernMissionEvent_organizationId_missionTaskId_seq_idx" ON "KernMissionEvent"("organizationId", "missionTaskId", "seq");
