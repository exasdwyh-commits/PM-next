-- =============================================================================
-- TASK-008 / D-001 / I-005：Product.identityCode 唯一性收敛到组织范围
--
-- 现状（修复前）：全局唯一（`Product_identityCode_key`，仅 identityCode 一列）。
--   后果：组织 A 建产品 "X" 后，组织 B **无法**用同一编码建自己的产品，且 B 能
--   **确定地**得到 409「该码被占」——即跨组织存在性 oracle（弱：不泄露行数据与
--   组织身份）。与契约 §2.3「跨组织一律 404、不泄露存在性」口径不一致。
--   （契约 §7.3 D-001、§10.2 I-005 登记；本迁移为约束半边，错误映射半边已在 D-015 完成。）
--
-- 修复后：组织内唯一（organizationId, identityCode 复合唯一）。
--   同组织同码 → 仍 409（P2002 中央映射，D-015）；异组织同码 → 允许。
--
-- 安全性：identityCode 为 NOT NULL，故「全局唯一」严格强于「组织级唯一」——
--   任意既有行集若能满足前者，必然满足后者，本迁移**不可能**因既有数据失败，
--   也不需要回填或改写任何产品 id（计划 TASK-008 要求保留现有产品 ID）。
-- =============================================================================

-- DropIndex
DROP INDEX "Product_identityCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_identityCode_key" ON "Product"("organizationId", "identityCode");
