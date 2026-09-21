-- =============================================================================
-- PC-0 Final Security Patch（2026-09-16）
--
-- 三项改动，均对应 PRODUCT_CENTER_CONTRACTS.md §10 已登记、已批准的最小增量：
--   1. OrganizationMember（最小组织成员模型）→ 修 D-003「org-admin 权限自举」
--   2. SignalItem 唯一约束加入组织范围      → 修 D-002「跨租户存在性泄漏」（I-004）
--   3. Artifact 三个业务正确性字段          → I-001 / I-002 / I-003
--
-- 本文件由 `prisma migrate diff --from-url <当前库> --to-schema-datamodel` 生成纯增量，
-- 再手工插入**数据回填**（Prisma 不生成 DML）。回填语句的位置是有意安排的：
-- 约束收紧与列新增必须在回填之后/之前，顺序错会导致迁移在真实库上失败。
--
-- 依赖：`OrganizationMember.id` 用 `gen_random_uuid()`，需要 PostgreSQL 13+（本机 17）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 组织成员角色与成员表
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ORG_ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_role_idx" ON "OrganizationMember"("organizationId", "role");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 1b. 回填：为每个既有用户建立组织成员记录
--
-- 角色映射规则（**一次性快照，不是活规则**）：
--   迁移前 `isOrgAdmin` 的实际口径是「本组织任一项目的 ORG_ADMIN 或 OWNER」。
--   把当时满足该口径的人映射为 ORG_ADMIN，是为了**不让任何人丢掉他实际已经拥有的能力**；
--   其余为 MEMBER。
--
-- 为什么必须是一次性快照：这条映射一旦写成运行时规则，就等于把「建项目 ⇒ 变管理员」
-- 的自举路径原样保留下来 —— 那正是本次要修的洞。快照之后，新建项目不再产生任何
-- 组织级权限，组织级权限只能通过 OrganizationMember 显式授予。
-- ---------------------------------------------------------------------------
INSERT INTO "OrganizationMember" ("id", "organizationId", "userId", "role", "createdAt")
SELECT
    gen_random_uuid()::text,
    u."organizationId",
    u.id,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM "ProjectMember" pm
            JOIN "Project" p ON p.id = pm."projectId"
            WHERE pm."userId" = u.id
              AND p."organizationId" = u."organizationId"
              AND pm."role" IN ('ORG_ADMIN', 'OWNER')
        )
        THEN 'ORG_ADMIN'::"OrgRole"
        ELSE 'MEMBER'::"OrgRole"
    END,
    NOW()
FROM "User" u
ON CONFLICT ("organizationId", "userId") DO NOTHING;

-- 兜底：任何组织若一个管理员都没有（例如全部成员都不是项目负责人），
-- 取该组织最早建立的账号为初始管理员，避免迁移后组织被锁死无法配置知识源。
UPDATE "OrganizationMember" m
SET "role" = 'ORG_ADMIN'::"OrgRole"
WHERE m.id IN (
    SELECT DISTINCT ON (x."organizationId") x.id
    FROM "OrganizationMember" x
    WHERE NOT EXISTS (
        SELECT 1 FROM "OrganizationMember" y
        WHERE y."organizationId" = x."organizationId" AND y."role" = 'ORG_ADMIN'
    )
    ORDER BY x."organizationId", x."createdAt", x."userId"
);

-- ---------------------------------------------------------------------------
-- 2. 信号去重指纹收敛到组织范围（D-002）
-- ---------------------------------------------------------------------------

-- DropIndex
DROP INDEX "SignalItem_sourceKey_hash_key";

-- 前置守卫：收紧为 NOT NULL 之前必须确认没有空归属行。
-- 若存在而直接 ALTER，会得到一个只说「null value in column」的报错，
-- 排查者看不出该怎么修。这里显式报错，并说明禁止猜测归属。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "SignalItem" WHERE "organizationId" IS NULL) THEN
        RAISE EXCEPTION
            '存在 organizationId 为空的 SignalItem 行，无法收紧为 NOT NULL。请按信号的实际来源逐条回填组织归属；禁止猜测或按标题相似度推断归属。';
    END IF;
END $$;

-- AlterTable
ALTER TABLE "SignalItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SignalItem_organizationId_sourceKey_hash_key" ON "SignalItem"("organizationId", "sourceKey", "hash");

-- ---------------------------------------------------------------------------
-- 3. Artifact 的组织 / 产品版本 / schema 版本
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "productVersionId" TEXT,
ADD COLUMN     "schemaVersion" TEXT;

-- ---------------------------------------------------------------------------
-- 3b. 回填：沿 workItem → project 推导组织与产品版本
--
-- 只回填可从真实关联推导出的值。`schemaVersion` **有意不回填**：
-- 既有 Artifact 的 content 是自由文本（实验报告 / 研究叙述），不是带 schemaVersion 的 JSON，
-- 给它填 "1.0" 等于替历史数据断言一个它并不满足的结构 —— 与本项目「未知即未知」一致，
-- 保持 NULL（= 未版本化的历史成果）比填一个猜测值更诚实。
-- 仍然为空的行 = 无项目归属的成果，属已知缺口，不在本次范围内。
-- ---------------------------------------------------------------------------
UPDATE "Artifact" a
SET "organizationId"   = COALESCE(a."organizationId", p."organizationId"),
    "productVersionId" = COALESCE(a."productVersionId", p."productVersionId")
FROM "WorkItem" w
JOIN "Project" p ON p.id = w."projectId"
WHERE a."workItemId" = w.id;

-- CreateIndex
CREATE INDEX "Artifact_organizationId_idx" ON "Artifact"("organizationId");

-- CreateIndex
CREATE INDEX "Artifact_productVersionId_idx" ON "Artifact"("productVersionId");

-- CreateIndex
CREATE INDEX "Artifact_organizationId_type_idx" ON "Artifact"("organizationId", "type");

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
