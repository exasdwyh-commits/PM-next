-- P1-01: 统一证据结构 (EvidenceClaim + DataGap) + Evidence 增加 productRef/channel

-- enums (must precede tables that reference them)
CREATE TYPE "EvidenceClaimKind" AS ENUM ('FACT', 'INFERENCE', 'ASSUMPTION');
CREATE TYPE "DataGapStatus" AS ENUM ('OPEN', 'FILLED');

-- AlterTable Evidence: 适用产品与渠道
ALTER TABLE "Evidence" ADD COLUMN     "channel" TEXT,
                             ADD COLUMN     "productRef" TEXT;

-- EvidenceClaim
CREATE TABLE "EvidenceClaim" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "kind" "EvidenceClaimKind" NOT NULL,
    "value" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "spec" TEXT,
    "unit" TEXT,
    "mechanism" TEXT,
    "applicableProduct" TEXT,
    "applicableChannel" TEXT,
    "conflictGroup" TEXT,
    "selectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvidenceClaim_evidenceId_idx" ON "EvidenceClaim"("evidenceId");
CREATE INDEX "EvidenceClaim_fieldKey_idx" ON "EvidenceClaim"("fieldKey");

-- DataGap
CREATE TABLE "DataGap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DataGapStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByEvidenceId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataGap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataGap_projectId_idx" ON "DataGap"("projectId");
CREATE INDEX "DataGap_fieldKey_idx" ON "DataGap"("fieldKey");
CREATE INDEX "DataGap_status_idx" ON "DataGap"("status");
CREATE UNIQUE INDEX "DataGap_projectId_fieldKey_key" ON "DataGap"("projectId", "fieldKey");

-- FKs
ALTER TABLE "EvidenceClaim" ADD CONSTRAINT "EvidenceClaim_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataGap" ADD CONSTRAINT "DataGap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataGap" ADD CONSTRAINT "DataGap_resolvedByEvidenceId_fkey" FOREIGN KEY ("resolvedByEvidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;