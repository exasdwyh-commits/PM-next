-- KX-31 连接器：用户接入的 MCP 服务器及其工具快照（读默认启用、写默认停用）
CREATE TABLE "KernConnector" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "lastError" TEXT,
    "refreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KernConnector_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KernConnector_organizationId_userId_idx" ON "KernConnector"("organizationId", "userId");
ALTER TABLE "KernConnector" ADD CONSTRAINT "KernConnector_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
