-- Kern visual artifacts (kern-rich/v1): stable key per conversation + immutable versions.
-- Additive only; existing messages keep rendering (they simply carry no artifact citations).
CREATE TABLE "KernArtifact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KernArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KernArtifactVersion" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "messageId" TEXT,
    "runId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "html" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KernArtifactVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KernArtifact_conversationId_key_key" ON "KernArtifact"("conversationId", "key");
CREATE INDEX "KernArtifact_organizationId_ownerId_idx" ON "KernArtifact"("organizationId", "ownerId");
CREATE UNIQUE INDEX "KernArtifactVersion_artifactId_version_key" ON "KernArtifactVersion"("artifactId", "version");
CREATE INDEX "KernArtifactVersion_messageId_idx" ON "KernArtifactVersion"("messageId");

ALTER TABLE "KernArtifact" ADD CONSTRAINT "KernArtifact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KernArtifactVersion" ADD CONSTRAINT "KernArtifactVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "KernArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
