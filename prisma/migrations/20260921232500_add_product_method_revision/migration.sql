-- Governance convergence: add explicit optimistic-lock token for product method changes.
ALTER TABLE "Product"
ADD COLUMN "methodRevision" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Product_organizationId_methodRevision_idx"
ON "Product"("organizationId", "methodRevision");
