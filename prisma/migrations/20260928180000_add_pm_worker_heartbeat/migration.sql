-- KX-34b Worker 心跳
CREATE TABLE "PmWorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "host" TEXT NOT NULL,
    "loops" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "PmWorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "PmWorkerHeartbeat_heartbeatAt_idx" ON "PmWorkerHeartbeat"("heartbeatAt");
