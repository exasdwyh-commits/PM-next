-- CreateEnum
CREATE TYPE "KernPlanTier" AS ENUM ('FREE', 'PRO', 'TEAM');

-- CreateTable
CREATE TABLE "OrganizationSubscription" (
    "organizationId" TEXT NOT NULL,
    "tier" "KernPlanTier" NOT NULL DEFAULT 'FREE',
    "externalRef" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("organizationId")
);

