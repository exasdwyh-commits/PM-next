-- KX-36 做法：把成功链路沉淀为可复用的计划模板
CREATE TABLE "KernPlaybook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceGoal" TEXT NOT NULL,
    "sourceMissionTaskId" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KernPlaybook_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KernPlaybook_userId_sourceMissionTaskId_key" ON "KernPlaybook"("userId", "sourceMissionTaskId");
CREATE INDEX "KernPlaybook_organizationId_userId_idx" ON "KernPlaybook"("organizationId", "userId");

ALTER TABLE "KernPlaybook" ADD CONSTRAINT "KernPlaybook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
