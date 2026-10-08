-- 第二版 patch 只带了 schema 文本、未带对应 DDL，此迁移补齐 P7 遗漏的数据库结构
-- 迁移前已确认 EvidenceVerification / EvidenceSourceCapture / ResearchRun / Feedback 均为 0 行，无数据丢失风险

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
DROP COLUMN "supportSpan",
ADD COLUMN     "supportSpan" JSONB;

-- AlterTable
ALTER TABLE "Feedback" ALTER COLUMN "topics" DROP DEFAULT;

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

