-- P8 Feedback 扩展：组织/用户维度字段 + 类型
-- Feedback 在 P8 是组织/用户维度反馈（Kern 对话反馈无项目上下文），故 projectId 可空

-- ModelRunStatus 增加 RESERVED（成本护栏 reserve 阶段）
ALTER TYPE "ModelRunStatus" ADD VALUE 'RESERVED';

-- FeedbackType 枚举
DO $$ BEGIN
  CREATE TYPE "FeedbackType" AS ENUM ('THUMBS_UP', 'THUMBS_DOWN', 'CORRECTION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Feedback" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "Feedback" ALTER COLUMN "targetType" SET DEFAULT 'kern_message';
ALTER TABLE "Feedback" ALTER COLUMN "targetId" DROP NOT NULL;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "missionId" TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "messageId" TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "typeFeedback" "FeedbackType";
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "source" TEXT;

CREATE INDEX IF NOT EXISTS "Feedback_organizationId_idx" ON "Feedback"("organizationId");
CREATE INDEX IF NOT EXISTS "Feedback_organizationId_authorId_idx" ON "Feedback"("organizationId", "authorId");

-- HarnessSample：反馈衍生的回归样本，只有 Outcome 证明变好才Promotion，可回滚
CREATE TABLE IF NOT EXISTS "HarnessSample" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "expected" TEXT NOT NULL,
  "actual" TEXT,
  "topics" TEXT[] NOT NULL,
  "source" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "outcome" TEXT,
  "promoted" BOOLEAN NOT NULL DEFAULT false,
  "promotedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "evaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HarnessSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HarnessSample_organizationId_idx" ON "HarnessSample"("organizationId");
CREATE INDEX IF NOT EXISTS "HarnessSample_userId_idx" ON "HarnessSample"("userId");
CREATE INDEX IF NOT EXISTS "HarnessSample_status_idx" ON "HarnessSample"("status");

DO $$ BEGIN
  ALTER TABLE "HarnessSample" ADD CONSTRAINT "HarnessSample_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
