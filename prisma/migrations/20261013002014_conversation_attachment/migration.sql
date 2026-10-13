-- CreateEnum
CREATE TYPE "AttachmentParseStatus" AS ENUM ('PENDING', 'READY', 'UNSUPPORTED', 'FAILED');

-- CreateTable
CREATE TABLE "ConversationAttachment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "messageId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "byteSize" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "parseStatus" "AttachmentParseStatus" NOT NULL DEFAULT 'PENDING',
    "parsedKind" TEXT,
    "extractedText" TEXT,
    "extractedMeta" JSONB,
    "parseNote" TEXT,
    "parsedAt" TIMESTAMP(3),
    "indexForSearch" BOOLEAN NOT NULL DEFAULT false,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationAttachment_conversationId_createdAt_idx" ON "ConversationAttachment"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationAttachment_conversationId_parseStatus_idx" ON "ConversationAttachment"("conversationId", "parseStatus");

-- CreateIndex
CREATE INDEX "ConversationAttachment_organizationId_idx" ON "ConversationAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "ConversationAttachment_indexForSearch_idx" ON "ConversationAttachment"("indexForSearch");

-- AddForeignKey
ALTER TABLE "ConversationAttachment" ADD CONSTRAINT "ConversationAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

