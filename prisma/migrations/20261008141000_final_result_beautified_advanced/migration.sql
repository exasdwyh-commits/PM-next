-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('regular_food', 'health_food', 'cross_border_food', 'cosmetics', 'custom');
-- CreateEnum
CREATE TYPE "CostScenarioStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED');
-- CreateTable
CREATE TABLE "CostScenario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL DEFAULT 'health_food',
    "productName" TEXT NOT NULL,
    "status" "CostScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "moduleValues" JSONB NOT NULL DEFAULT '{}',
    "bomItems" JSONB NOT NULL DEFAULT '[]',
    "supplierQuotes" JSONB NOT NULL DEFAULT '[]',
    "complianceItems" JSONB NOT NULL DEFAULT '[]',
    "totalMaterialCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalManufacturingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPackagingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalLogisticsCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalComplianceCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalChannelCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedRetailPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitMargin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostScenario_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "CostScenarioComment" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostScenarioComment_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "CostScenarioVersion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "moduleValues" JSONB NOT NULL,
    "bomItems" JSONB NOT NULL,
    "supplierQuotes" JSONB NOT NULL,
    "complianceItems" JSONB NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "changeNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostScenarioVersion_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "CostScenarioApproval" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "CostScenarioStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostScenarioApproval_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "CostScenario_organizationId_projectId_idx" ON "CostScenario"("organizationId", "projectId");
-- CreateIndex
CREATE INDEX "CostScenario_category_idx" ON "CostScenario"("category");
-- CreateIndex
CREATE INDEX "CostScenario_status_idx" ON "CostScenario"("status");
-- CreateIndex
CREATE INDEX "CostScenario_createdBy_idx" ON "CostScenario"("createdBy");
-- CreateIndex
CREATE INDEX "CostScenario_createdAt_idx" ON "CostScenario"("createdAt");
-- CreateIndex
CREATE INDEX "CostScenarioComment_scenarioId_idx" ON "CostScenarioComment"("scenarioId");
-- CreateIndex
CREATE INDEX "CostScenarioComment_organizationId_idx" ON "CostScenarioComment"("organizationId");
-- CreateIndex
CREATE INDEX "CostScenarioVersion_scenarioId_idx" ON "CostScenarioVersion"("scenarioId");
-- CreateIndex
CREATE UNIQUE INDEX "CostScenarioVersion_scenarioId_version_key" ON "CostScenarioVersion"("scenarioId", "version");
-- CreateIndex
CREATE INDEX "CostScenarioApproval_scenarioId_idx" ON "CostScenarioApproval"("scenarioId");
-- CreateIndex
CREATE INDEX "CostScenarioApproval_organizationId_idx" ON "CostScenarioApproval"("organizationId");
-- CreateIndex
CREATE INDEX "CostScenarioApproval_status_idx" ON "CostScenarioApproval"("status");
-- AddForeignKey
ALTER TABLE "CostScenario" ADD CONSTRAINT "CostScenario_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenario" ADD CONSTRAINT "CostScenario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenario" ADD CONSTRAINT "CostScenario_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioComment" ADD CONSTRAINT "CostScenarioComment_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CostScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioComment" ADD CONSTRAINT "CostScenarioComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioVersion" ADD CONSTRAINT "CostScenarioVersion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CostScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioVersion" ADD CONSTRAINT "CostScenarioVersion_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioApproval" ADD CONSTRAINT "CostScenarioApproval_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CostScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioApproval" ADD CONSTRAINT "CostScenarioApproval_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CostScenarioApproval" ADD CONSTRAINT "CostScenarioApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
