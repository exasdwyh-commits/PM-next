-- CreateEnum
CREATE TYPE "KernMemoryKind" AS ENUM ('PREFERENCE', 'FACT', 'DECISION', 'OUTCOME');

-- CreateTable
CREATE TABLE "KernMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "KernMemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "forgottenAt" TIMESTAMP(3),

    CONSTRAINT "KernMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KernMemory_organizationId_userId_forgottenAt_idx" ON "KernMemory"("organizationId", "userId", "forgottenAt");

-- CreateIndex
CREATE UNIQUE INDEX "KernMemory_userId_source_key" ON "KernMemory"("userId", "source");

-- AddForeignKey
ALTER TABLE "KernMemory" ADD CONSTRAINT "KernMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

