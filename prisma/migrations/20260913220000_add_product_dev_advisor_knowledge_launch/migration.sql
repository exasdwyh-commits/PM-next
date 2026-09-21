-- CreateEnum
CREATE TYPE "ProductLifecycleStage" AS ENUM ('IDEA', 'ANALYSIS', 'SAMPLING', 'LAUNCH_PREP', 'LAUNCHED', 'REVIEW', 'PAUSED');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisRunKind" AS ENUM ('BASELINE', 'REVISION_REVIEW');

-- CreateEnum
CREATE TYPE "AnalysisDimensionKey" AS ENUM ('DEMAND_VALUE', 'DIFFERENTIATION', 'UNIT_ECONOMICS', 'COMPANY_FIT', 'DELIVERY_FEASIBILITY', 'LAUNCH_READINESS');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('ADVISOR', 'PRODUCT');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_CONFIRMATION', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionProposalStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'APPLIED', 'REJECTED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceKind" AS ENUM ('OBSIDIAN_VAULT', 'LOCAL_DIR');

-- CreateEnum
CREATE TYPE "KnowledgeSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CompanyFactStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LaunchPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LaunchMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "actualLaunchDate" TIMESTAMP(3),
ADD COLUMN     "coreIdea" TEXT,
ADD COLUMN     "coreSellingPoints" TEXT,
ADD COLUMN     "forbiddenItems" TEXT,
ADD COLUMN     "formSpec" TEXT,
ADD COLUMN     "lifecycleStage" "ProductLifecycleStage" NOT NULL DEFAULT 'IDEA',
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "priceExpectation" TEXT,
ADD COLUMN     "sourceKind" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "targetChannels" TEXT,
ADD COLUMN     "targetLaunchDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "SignalItem" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "SignalSource" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "kind" "AnalysisRunKind" NOT NULL DEFAULT 'BASELINE',
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'RUNNING',
    "inputSnapshot" JSONB NOT NULL,
    "evidenceFingerprint" TEXT,
    "ruleVersion" TEXT NOT NULL DEFAULT 'v1',
    "provider" TEXT,
    "modelId" TEXT,
    "runMode" "RunMode" NOT NULL DEFAULT 'MANUAL',
    "supersedesRunId" TEXT,
    "errorReason" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisDimension" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "dimension" "AnalysisDimensionKey" NOT NULL,
    "score" INTEGER,
    "basis" TEXT,
    "assumptions" TEXT,
    "gaps" TEXT,
    "recommendation" TEXT,
    "humanAdjustReason" TEXT,
    "evidenceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisDimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "ruleVersion" TEXT NOT NULL DEFAULT 'v1',
    "coverageRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "weightedScore" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL DEFAULT 'ADVISOR',
    "title" TEXT NOT NULL,
    "productId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "runId" TEXT,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "contextSnapshot" JSONB,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "modelId" TEXT,
    "promptTemplateVersion" TEXT,
    "runMode" "RunMode" NOT NULL DEFAULT 'TEST_STUB',
    "toolWhitelist" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "leaseOwner" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "usageJson" JSONB,
    "costStatus" TEXT NOT NULL DEFAULT 'unknown',
    "errorReason" TEXT,
    "outputMessageId" TEXT,
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "inputJson" JSONB,
    "resultJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "errorReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT,
    "conversationId" TEXT,
    "productId" TEXT,
    "projectId" TEXT,
    "actionType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" "ActionProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "proposedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "appliedObjectType" TEXT,
    "appliedObjectId" TEXT,
    "idempotencyKey" TEXT,
    "baseVersionHash" TEXT,
    "expectedRevision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "KnowledgeSourceKind" NOT NULL DEFAULT 'OBSIDIAN_VAULT',
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includeGlobs" JSONB,
    "excludeGlobs" JSONB,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "frontmatter" JSONB,
    "contentHash" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "wordCount" INTEGER,
    "sourceUpdatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "headingPath" TEXT,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "KnowledgeSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "failures" JSONB,
    "errorReason" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyFact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" "CompanyFactStatus" NOT NULL DEFAULT 'PENDING',
    "sourceDocId" TEXT,
    "sourcePath" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "status" "LaunchPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "actualLaunchedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchMilestone" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "seq" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "status" "LaunchMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "blockerReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "workItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisRun_organizationId_idx" ON "AnalysisRun"("organizationId");

-- CreateIndex
CREATE INDEX "AnalysisRun_productId_idx" ON "AnalysisRun"("productId");

-- CreateIndex
CREATE INDEX "AnalysisRun_productVersionId_idx" ON "AnalysisRun"("productVersionId");

-- CreateIndex
CREATE INDEX "AnalysisRun_status_idx" ON "AnalysisRun"("status");

-- CreateIndex
CREATE INDEX "AnalysisDimension_runId_idx" ON "AnalysisDimension"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisDimension_runId_dimension_key" ON "AnalysisDimension"("runId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_runId_key" ON "Scorecard"("runId");

-- CreateIndex
CREATE INDEX "Scorecard_productId_idx" ON "Scorecard"("productId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_idx" ON "Conversation"("organizationId");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_idx" ON "Conversation"("ownerId");

-- CreateIndex
CREATE INDEX "Conversation_productId_idx" ON "Conversation"("productId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_idx" ON "AgentRun"("organizationId");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "ToolCall_runId_idx" ON "ToolCall"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_idempotencyKey_key" ON "ActionProposal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActionProposal_organizationId_idx" ON "ActionProposal"("organizationId");

-- CreateIndex
CREATE INDEX "ActionProposal_conversationId_idx" ON "ActionProposal"("conversationId");

-- CreateIndex
CREATE INDEX "ActionProposal_productId_idx" ON "ActionProposal"("productId");

-- CreateIndex
CREATE INDEX "ActionProposal_status_idx" ON "ActionProposal"("status");

-- CreateIndex
CREATE INDEX "KnowledgeSource_organizationId_idx" ON "KnowledgeSource"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_organizationId_idx" ON "KnowledgeDocument"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_sourceId_idx" ON "KnowledgeDocument"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_sourceId_relativePath_key" ON "KnowledgeDocument"("sourceId", "relativePath");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_organizationId_idx" ON "KnowledgeChunk"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeSyncRun_organizationId_idx" ON "KnowledgeSyncRun"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeSyncRun_sourceId_idx" ON "KnowledgeSyncRun"("sourceId");

-- CreateIndex
CREATE INDEX "CompanyFact_organizationId_idx" ON "CompanyFact"("organizationId");

-- CreateIndex
CREATE INDEX "CompanyFact_status_idx" ON "CompanyFact"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyFact_organizationId_key_key" ON "CompanyFact"("organizationId", "key");

-- CreateIndex
CREATE INDEX "LaunchPlan_organizationId_idx" ON "LaunchPlan"("organizationId");

-- CreateIndex
CREATE INDEX "LaunchPlan_productId_idx" ON "LaunchPlan"("productId");

-- CreateIndex
CREATE INDEX "LaunchPlan_status_idx" ON "LaunchPlan"("status");

-- CreateIndex
CREATE INDEX "LaunchMilestone_organizationId_idx" ON "LaunchMilestone"("organizationId");

-- CreateIndex
CREATE INDEX "LaunchMilestone_planId_idx" ON "LaunchMilestone"("planId");

-- CreateIndex
CREATE INDEX "LaunchMilestone_status_idx" ON "LaunchMilestone"("status");

-- CreateIndex
CREATE INDEX "Product_ownerId_idx" ON "Product"("ownerId");

-- CreateIndex
CREATE INDEX "Product_lifecycleStage_idx" ON "Product"("lifecycleStage");

-- CreateIndex
CREATE INDEX "Project_productId_idx" ON "Project"("productId");

-- CreateIndex
CREATE INDEX "SignalItem_organizationId_idx" ON "SignalItem"("organizationId");

-- CreateIndex
CREATE INDEX "SignalSource_organizationId_idx" ON "SignalSource"("organizationId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisDimension" ADD CONSTRAINT "AnalysisDimension_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSyncRun" ADD CONSTRAINT "KnowledgeSyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSyncRun" ADD CONSTRAINT "KnowledgeSyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSyncRun" ADD CONSTRAINT "KnowledgeSyncRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFact" ADD CONSTRAINT "CompanyFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFact" ADD CONSTRAINT "CompanyFact_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPlan" ADD CONSTRAINT "LaunchPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPlan" ADD CONSTRAINT "LaunchPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPlan" ADD CONSTRAINT "LaunchPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPlan" ADD CONSTRAINT "LaunchPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchMilestone" ADD CONSTRAINT "LaunchMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchMilestone" ADD CONSTRAINT "LaunchMilestone_planId_fkey" FOREIGN KEY ("planId") REFERENCES "LaunchPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchMilestone" ADD CONSTRAINT "LaunchMilestone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

