-- KX-34 定时与主动
CREATE TABLE "KernSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "conversationId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KernSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KernSchedule_enabled_nextRunAt_idx" ON "KernSchedule"("enabled", "nextRunAt");
CREATE INDEX "KernSchedule_organizationId_userId_idx" ON "KernSchedule"("organizationId", "userId");

ALTER TABLE "KernSchedule" ADD CONSTRAINT "KernSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
