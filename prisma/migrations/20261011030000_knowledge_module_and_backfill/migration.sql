-- CreateEnum
CREATE TYPE "KnowledgeModule" AS ENUM ('COMPLIANCE_REDLINE', 'CATEGORY_FRAMEWORK', 'CHANNEL_ACCESS', 'OPERATION_SOP');

-- CreateTable
CREATE TABLE "KnowledgeModuleEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "module" "KnowledgeModule" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT,
    "scopeLabel" TEXT,
    "sourceRef" TEXT NOT NULL,
    "authorityTier" TEXT NOT NULL DEFAULT 'curated',
    "appliesTo" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeModuleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBackfill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT,
    "metricKey" TEXT NOT NULL,
    "numericLow" DOUBLE PRECISION,
    "numericHigh" DOUBLE PRECISION,
    "numericValue" DOUBLE PRECISION,
    "unit" TEXT,
    "textValue" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeBackfill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeModuleEntry_organizationId_module_idx" ON "KnowledgeModuleEntry"("organizationId", "module");

-- CreateIndex
CREATE INDEX "KnowledgeModuleEntry_organizationId_deletedAt_idx" ON "KnowledgeModuleEntry"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeModuleEntry_organizationId_module_key_key" ON "KnowledgeModuleEntry"("organizationId", "module", "key");

-- CreateIndex
CREATE INDEX "KnowledgeBackfill_organizationId_metricKey_idx" ON "KnowledgeBackfill"("organizationId", "metricKey");

-- CreateIndex
CREATE INDEX "KnowledgeBackfill_entryId_idx" ON "KnowledgeBackfill"("entryId");

-- CreateIndex
CREATE INDEX "KnowledgeBackfill_organizationId_observedAt_idx" ON "KnowledgeBackfill"("organizationId", "observedAt");

-- AddForeignKey
ALTER TABLE "KnowledgeModuleEntry" ADD CONSTRAINT "KnowledgeModuleEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeModuleEntry" ADD CONSTRAINT "KnowledgeModuleEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBackfill" ADD CONSTRAINT "KnowledgeBackfill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBackfill" ADD CONSTRAINT "KnowledgeBackfill_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeModuleEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBackfill" ADD CONSTRAINT "KnowledgeBackfill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

