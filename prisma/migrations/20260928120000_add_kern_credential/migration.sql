-- KX-30 凭证保管层：AES-256-GCM 加密的 header 组，永不回显
CREATE TABLE "KernCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "cipher" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "oneTime" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KernCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KernCredential_organizationId_userId_revokedAt_idx" ON "KernCredential"("organizationId", "userId", "revokedAt");
CREATE INDEX "KernCredential_userId_target_idx" ON "KernCredential"("userId", "target");
ALTER TABLE "KernCredential" ADD CONSTRAINT "KernCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
