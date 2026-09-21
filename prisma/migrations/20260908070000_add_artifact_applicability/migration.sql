-- CreateEnum
CREATE TYPE "ArtifactApplicabilityStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "ArtifactApplicability" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "baselineRevision" INTEGER NOT NULL,
    "sourceInputRevision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "ArtifactApplicabilityStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactApplicability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtifactApplicability_artifactId_baselineRevision_idx" ON "ArtifactApplicability"("artifactId", "baselineRevision");

-- CreateIndex
CREATE INDEX "ArtifactApplicability_workItemId_idx" ON "ArtifactApplicability"("workItemId");

-- CreateIndex
CREATE INDEX "ArtifactApplicability_submissionId_idx" ON "ArtifactApplicability"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactApplicability_artifactId_submissionId_key" ON "ArtifactApplicability"("artifactId", "submissionId");

-- AddForeignKey
ALTER TABLE "ArtifactApplicability" ADD CONSTRAINT "ArtifactApplicability_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactApplicability" ADD CONSTRAINT "ArtifactApplicability_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WorkSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactApplicability" ADD CONSTRAINT "ArtifactApplicability_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactApplicability" ADD CONSTRAINT "ArtifactApplicability_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

