-- Model Control Center V1
-- Organization-scoped model profiles, task-class policies and Agent bindings.
-- API credentials/secrets are intentionally not persisted in these tables.

CREATE TABLE "ModelProfileConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "provider" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "locality" TEXT NOT NULL,
  "health" TEXT NOT NULL DEFAULT 'HEALTHY',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "qualityTier" TEXT NOT NULL,
  "latencyTier" TEXT NOT NULL,
  "costTier" TEXT NOT NULL,
  "contextWindow" INTEGER,
  "dataPolicyNote" TEXT,
  "isPreset" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelProfileConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelPolicyConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" TEXT NOT NULL,
  "taskClass" TEXT NOT NULL,
  "candidates" JSONB NOT NULL,
  "requiredCapabilities" JSONB NOT NULL,
  "cloudAllowed" BOOLEAN NOT NULL DEFAULT true,
  "maxContextRequirement" INTEGER,
  "failurePolicy" JSONB,
  "isPreset" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelPolicyConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentModelPolicyBinding" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "taskClass" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentModelPolicyBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelProfileConfig_organizationId_key_key"
  ON "ModelProfileConfig"("organizationId", "key");
CREATE INDEX "ModelProfileConfig_organizationId_enabled_idx"
  ON "ModelProfileConfig"("organizationId", "enabled");
CREATE INDEX "ModelProfileConfig_organizationId_provider_idx"
  ON "ModelProfileConfig"("organizationId", "provider");

CREATE UNIQUE INDEX "ModelPolicyConfig_organizationId_key_key"
  ON "ModelPolicyConfig"("organizationId", "key");
CREATE INDEX "ModelPolicyConfig_organizationId_taskClass_idx"
  ON "ModelPolicyConfig"("organizationId", "taskClass");

CREATE UNIQUE INDEX "AgentModelPolicyBinding_agentId_taskClass_key"
  ON "AgentModelPolicyBinding"("agentId", "taskClass");
CREATE INDEX "AgentModelPolicyBinding_organizationId_policyKey_idx"
  ON "AgentModelPolicyBinding"("organizationId", "policyKey");
CREATE INDEX "AgentModelPolicyBinding_organizationId_taskClass_idx"
  ON "AgentModelPolicyBinding"("organizationId", "taskClass");

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelPolicyConfig"
  ADD CONSTRAINT "ModelPolicyConfig_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentModelPolicyBinding"
  ADD CONSTRAINT "AgentModelPolicyBinding_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentModelPolicyBinding"
  ADD CONSTRAINT "AgentModelPolicyBinding_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_locality_check"
  CHECK ("locality" IN ('CLOUD', 'LOCAL'));

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_health_check"
  CHECK ("health" IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE'));

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_qualityTier_check"
  CHECK ("qualityTier" IN ('FAST', 'BALANCED', 'FRONTIER'));

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_latencyTier_check"
  CHECK ("latencyTier" IN ('FAST', 'NORMAL', 'SLOW'));

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_costTier_check"
  CHECK ("costTier" IN ('FREE', 'LOW', 'STANDARD', 'PREMIUM', 'FIXED_LOCAL'));

ALTER TABLE "ModelProfileConfig"
  ADD CONSTRAINT "ModelProfileConfig_contextWindow_check"
  CHECK ("contextWindow" IS NULL OR "contextWindow" > 0);

ALTER TABLE "ModelPolicyConfig"
  ADD CONSTRAINT "ModelPolicyConfig_contextRequirement_check"
  CHECK ("maxContextRequirement" IS NULL OR "maxContextRequirement" > 0);
