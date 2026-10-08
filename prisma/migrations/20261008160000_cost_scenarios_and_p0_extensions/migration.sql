-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('regular_food', 'health_food', 'cross_border_food', 'cosmetics', 'custom');

-- CreateEnum
CREATE TYPE "CostScenarioStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "EvidenceSourceCapture" ADD COLUMN     "content" TEXT,
ADD COLUMN     "finalUrl" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "researchRunId" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "url" TEXT,
ALTER COLUMN "evidenceId" DROP NOT NULL,
ALTER COLUMN "sourceType" SET DEFAULT 'WEB',
ALTER COLUMN "httpStatus" SET DEFAULT 200,
ALTER COLUMN "rawContentPreview" SET DEFAULT '',
ALTER COLUMN "fetchedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "fetcherIdentity" SET DEFAULT 'source-fetcher';

-- AlterTable
ALTER TABLE "EvidenceVerification" ADD COLUMN     "claimId" TEXT,
ADD COLUMN     "evidenceLevel" TEXT,
ADD COLUMN     "organizationId" TEXT,
ALTER COLUMN "evidenceClaimId" DROP NOT NULL,
ALTER COLUMN "supportSpan" TYPE JSONB USING to_jsonb("supportSpan");

-- AlterTable
ALTER TABLE "ModelRun" ADD COLUMN     "actualTokens" INTEGER,
ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "estimatedTokens" INTEGER,
ADD COLUMN     "missionId" TEXT,
ADD COLUMN     "reservationId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "modelCallQuota" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "modelCallUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "missionId" TEXT,
ADD COLUMN     "nodeKey" TEXT,
ADD COLUMN     "revisionRound" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "UsageLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "missionId" TEXT,
    "agentId" TEXT,
    "taskClass" TEXT,
    "eventType" TEXT NOT NULL,
    "modelProfileKey" TEXT,
    "estimatedTokens" INTEGER,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT,
    "messageId" TEXT,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessSample" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "promotedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageLedger_reservationId_key" ON "UsageLedger"("reservationId");

-- CreateIndex
CREATE INDEX "UsageLedger_organizationId_createdAt_idx" ON "UsageLedger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLedger_missionId_idx" ON "UsageLedger"("missionId");

-- CreateIndex
CREATE INDEX "UsageLedger_eventType_idx" ON "UsageLedger"("eventType");

-- CreateIndex
CREATE INDEX "UsageLedger_reservationId_idx" ON "UsageLedger"("reservationId");

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

-- CreateIndex
CREATE INDEX "UserFeedback_organizationId_userId_createdAt_idx" ON "UserFeedback"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserFeedback_missionId_idx" ON "UserFeedback"("missionId");

-- CreateIndex
CREATE INDEX "UserFeedback_type_idx" ON "UserFeedback"("type");

-- CreateIndex
CREATE INDEX "HarnessSample_organizationId_userId_idx" ON "HarnessSample"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "HarnessSample_status_idx" ON "HarnessSample"("status");

-- CreateIndex
CREATE INDEX "HarnessSample_promoted_idx" ON "HarnessSample"("promoted");

-- CreateIndex
CREATE INDEX "EvidenceSourceCapture_organizationId_idx" ON "EvidenceSourceCapture"("organizationId");

-- CreateIndex
CREATE INDEX "EvidenceSourceCapture_researchRunId_idx" ON "EvidenceSourceCapture"("researchRunId");

-- CreateIndex
CREATE INDEX "EvidenceVerification_organizationId_idx" ON "EvidenceVerification"("organizationId");

-- CreateIndex
CREATE INDEX "EvidenceVerification_claimId_idx" ON "EvidenceVerification"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRun_reservationId_key" ON "ModelRun"("reservationId");

-- CreateIndex
CREATE INDEX "ModelRun_missionId_idx" ON "ModelRun"("missionId");

-- CreateIndex
CREATE INDEX "ModelRun_reservationId_idx" ON "ModelRun"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_idempotencyKey_key" ON "ResearchRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ResearchRun_missionId_idx" ON "ResearchRun"("missionId");

-- CreateIndex
CREATE INDEX "ResearchRun_idempotencyKey_idx" ON "ResearchRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ResearchRun_nodeKey_idx" ON "ResearchRun"("nodeKey");

-- AddForeignKey
ALTER TABLE "EvidenceSourceCapture" ADD CONSTRAINT "EvidenceSourceCapture_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

