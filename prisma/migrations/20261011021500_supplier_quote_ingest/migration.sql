-- CreateEnum
CREATE TYPE "SupplierQuoteKind" AS ENUM ('SPEC', 'PRICE');

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "kind" "SupplierQuoteKind" NOT NULL,
    "supplier" TEXT,
    "item" TEXT NOT NULL,
    "spec" TEXT,
    "uom" TEXT,
    "moq" TEXT,
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "quotedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierQuote_projectId_kind_idx" ON "SupplierQuote"("projectId", "kind");

-- CreateIndex
CREATE INDEX "SupplierQuote_evidenceId_idx" ON "SupplierQuote"("evidenceId");

-- CreateIndex
CREATE INDEX "SupplierQuote_organizationId_createdAt_idx" ON "SupplierQuote"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
