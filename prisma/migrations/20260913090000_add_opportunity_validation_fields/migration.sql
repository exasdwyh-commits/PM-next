-- P1-02: Evidence 增加市场验证字段（样本规模/时间范围/局限）与验证状态

-- enum must precede columns that reference it
CREATE TYPE "ValidationStatus" AS ENUM ('UNAPPLIED', 'IN_PROGRESS', 'VERIFIED_BY_LEAD');

-- AlterTable Evidence（纯新增，不影响既有行；市场验证状态仅负责人可手动置 VERIFIED_BY_LEAD）
ALTER TABLE "Evidence" ADD COLUMN     "validationSampleSize" TEXT,
                       ADD COLUMN     "validationTimeRange" TEXT,
                       ADD COLUMN     "validationLimitations" TEXT,
                       ADD COLUMN     "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'UNAPPLIED';