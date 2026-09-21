-- =============================================================================
-- TASK-007 / D-006 修复：补齐「缺失基线」迁移
-- （排序必须在首次缺表引用 20260913220000 之前、20260913090000 之后）
--
-- 背景（docs/product-center/MIGRATION_REPLAY_REPORT.md §①）：
--   SignalItem / SignalSource / ResearchRun / ResearchRunTask / ResearchRunSnapshot
--   五张表与 ResearchRunStatus / ResearchRunTaskStatus / ResearchTaskType 三个枚举
--   在全部迁移中均无 CREATE（历史上由 db push 建立），但 20260913220000 起有迁移
--   ALTER 它们 → 空库重放断在第 6 个迁移（P3018 / 42P01 relation "SignalItem" does not exist）。
--
-- 本文件表达「20260913220000 之前」这些对象的历史结构，因此有意**不含**：
--   - SignalItem / SignalSource 的 organizationId 列及其索引
--     （由 20260913220000 新增；SignalItem 侧的 NOT NULL 收紧与组织级去重唯一索引
--      由 20260916010000 完成，其前置守卫依赖本文件建立的历史全局唯一键形态）；
--   - RunMode 枚举的 'LLM' 值（由 20260919010000 追加）。
--
-- 取证方式（可追溯）：列定义/默认值/索引名/外键动作逐项取自既有库
-- （db push 时期建立；hermes_next_dev 与 hermes_next_test 的 DDL 经 pg_dump 比对逐字一致），
-- 再与 schema.prisma 当前定义做减法核对（减去上述三个后续迁移的作用）。
-- 未虚构任何对象；枚举值顺序与既有库 pg_enum.enumsortorder 一致。
-- =============================================================================

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('RUNNING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResearchRunTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResearchTaskType" AS ENUM ('CLARIFY_SCOPE', 'BRANCH_MARKET', 'BRANCH_PRODUCT', 'BRANCH_CAPABILITY', 'OTHER');

-- CreateTable
CREATE TABLE "SignalSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'trend',
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" TEXT NOT NULL DEFAULT 'P1',
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "lastStatus" TEXT DEFAULT 'idle',
    "lastError" TEXT,
    "lastCollected" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalItem" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'trend',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "relevance" TEXT,
    "url" TEXT,
    "nature" "EvidenceNature" NOT NULL DEFAULT 'REAL',
    "verifyStatus" "EvidenceVerifyStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "productRef" TEXT,
    "channel" TEXT,
    "hash" TEXT,
    "evidenceId" TEXT,
    "rawJson" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "valueTier" TEXT,
    "valueReason" TEXT,
    "collectedBy" TEXT NOT NULL DEFAULT 'manual',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "inputRevision" INTEGER NOT NULL,
    "scopeSnapshotJson" JSONB NOT NULL,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'RUNNING',
    "createdById" TEXT NOT NULL,
    "publishedSnapshotId" TEXT,
    "errorReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRunTask" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskType" "ResearchTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ResearchRunTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "inputJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "errorReason" TEXT,
    "runnerPid" INTEGER,
    "runnerBootId" TEXT,
    "parentTaskId" TEXT,
    "seq" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ResearchRunTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRunSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "reportVersion" INTEGER NOT NULL,
    "reportJson" JSONB NOT NULL,
    "publishedStatus" TEXT NOT NULL DEFAULT 'published',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchRunSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignalSource_key_key" ON "SignalSource"("key");

-- CreateIndex
CREATE INDEX "SignalSource_enabled_priority_idx" ON "SignalSource"("enabled", "priority");

-- CreateIndex
CREATE INDEX "SignalItem_sourceKey_idx" ON "SignalItem"("sourceKey");

-- CreateIndex
CREATE INDEX "SignalItem_category_idx" ON "SignalItem"("category");

-- CreateIndex
CREATE INDEX "SignalItem_valueTier_idx" ON "SignalItem"("valueTier");

-- CreateIndex
-- 历史全局形态（不含组织范围）；20260916010000 会 DROP 本索引并替换为
-- "SignalItem_organizationId_sourceKey_hash_key"（D-002 跨租户存在性泄漏修复）。
CREATE UNIQUE INDEX "SignalItem_sourceKey_hash_key" ON "SignalItem"("sourceKey", "hash");

-- CreateIndex
CREATE INDEX "ResearchRun_projectId_idx" ON "ResearchRun"("projectId");

-- CreateIndex
CREATE INDEX "ResearchRun_status_idx" ON "ResearchRun"("status");

-- CreateIndex
CREATE INDEX "ResearchRunTask_runId_idx" ON "ResearchRunTask"("runId");

-- CreateIndex
CREATE INDEX "ResearchRunTask_status_idx" ON "ResearchRunTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRunSnapshot_runId_reportVersion_key" ON "ResearchRunSnapshot"("runId", "reportVersion");

-- CreateIndex
CREATE INDEX "ResearchRunSnapshot_runId_idx" ON "ResearchRunSnapshot"("runId");

-- AddForeignKey
ALTER TABLE "SignalItem" ADD CONSTRAINT "SignalItem_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "SignalSource"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRunTask" ADD CONSTRAINT "ResearchRunTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRunTask" ADD CONSTRAINT "ResearchRunTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ResearchRunTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRunTask" ADD CONSTRAINT "ResearchRunTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRunSnapshot" ADD CONSTRAINT "ResearchRunSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
