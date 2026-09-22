-- Autonomous Workforce Kernel
-- Agent = long-lived digital employee identity
-- AgentTask = one assignment
-- AgentRun = one execution attempt
-- Delegation = durable hand-off provenance

CREATE TYPE "AgentLifecycleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AgentAccessMode" AS ENUM ('OWNER_ONLY', 'ORGANIZATION');
CREATE TYPE "SkillLifecycleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "SquadLifecycleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "SquadMemberType" AS ENUM ('AGENT', 'HUMAN');
CREATE TYPE "AgentTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'BLOCKED', 'WAITING_HUMAN', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "AgentTriggerType" AS ENUM ('MANUAL', 'WORK_ITEM', 'DELEGATION', 'SYSTEM', 'AUTOPILOT', 'EVENT', 'API');
CREATE TYPE "DelegationStatus" AS ENUM ('CREATED', 'ACCEPTED', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "AgentRun"
  ADD COLUMN "agentId" TEXT,
  ADD COLUMN "agentTaskId" TEXT,
  ADD COLUMN "triggerType" "AgentTriggerType",
  ADD COLUMN "triggerRef" TEXT;

CREATE TABLE "Agent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "roleKey" TEXT NOT NULL,
  "instructions" TEXT NOT NULL DEFAULT '',
  "modelPolicyKey" TEXT,
  "maxConcurrentTasks" INTEGER NOT NULL DEFAULT 2,
  "accessMode" "AgentAccessMode" NOT NULL DEFAULT 'OWNER_ONLY',
  "ownerId" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "status" "AgentLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Skill" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "instructions" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "references" JSONB,
  "allowedTools" JSONB,
  "outputSchema" JSONB,
  "status" "SkillLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentSkill" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "assignedById" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Squad" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "instructions" TEXT NOT NULL DEFAULT '',
  "leaderAgentId" TEXT NOT NULL,
  "createdById" TEXT,
  "status" "SquadLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SquadMember" (
  "id" TEXT NOT NULL,
  "squadId" TEXT NOT NULL,
  "memberType" "SquadMemberType" NOT NULL,
  "agentId" TEXT,
  "userId" TEXT,
  "roleDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SquadMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTask" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workItemId" TEXT,
  "squadId" TEXT,
  "parentTaskId" TEXT,
  "goal" TEXT NOT NULL,
  "contextSnapshot" JSONB,
  "status" "AgentTaskStatus" NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 50,
  "triggerType" "AgentTriggerType" NOT NULL DEFAULT 'MANUAL',
  "triggerRef" TEXT,
  "blockedReason" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "createdByUserId" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentDelegation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "toAgentId" TEXT NOT NULL,
  "parentTaskId" TEXT,
  "childTaskId" TEXT NOT NULL,
  "sourceRunId" TEXT,
  "reason" TEXT NOT NULL,
  "status" "DelegationStatus" NOT NULL DEFAULT 'CREATED',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentDelegation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Agent_organizationId_code_key" ON "Agent"("organizationId", "code");
CREATE INDEX "Agent_organizationId_status_idx" ON "Agent"("organizationId", "status");
CREATE INDEX "Agent_ownerId_idx" ON "Agent"("ownerId");

CREATE UNIQUE INDEX "Skill_organizationId_key_key" ON "Skill"("organizationId", "key");
CREATE INDEX "Skill_organizationId_status_idx" ON "Skill"("organizationId", "status");

CREATE UNIQUE INDEX "AgentSkill_agentId_skillId_key" ON "AgentSkill"("agentId", "skillId");
CREATE INDEX "AgentSkill_skillId_idx" ON "AgentSkill"("skillId");

CREATE UNIQUE INDEX "Squad_organizationId_code_key" ON "Squad"("organizationId", "code");
CREATE INDEX "Squad_organizationId_status_idx" ON "Squad"("organizationId", "status");
CREATE INDEX "Squad_leaderAgentId_idx" ON "Squad"("leaderAgentId");

CREATE UNIQUE INDEX "SquadMember_squadId_agentId_key" ON "SquadMember"("squadId", "agentId");
CREATE UNIQUE INDEX "SquadMember_squadId_userId_key" ON "SquadMember"("squadId", "userId");
CREATE INDEX "SquadMember_agentId_idx" ON "SquadMember"("agentId");
CREATE INDEX "SquadMember_userId_idx" ON "SquadMember"("userId");

CREATE INDEX "AgentTask_organizationId_status_idx" ON "AgentTask"("organizationId", "status");
CREATE INDEX "AgentTask_agentId_status_idx" ON "AgentTask"("agentId", "status");
CREATE INDEX "AgentTask_workItemId_idx" ON "AgentTask"("workItemId");
CREATE INDEX "AgentTask_squadId_idx" ON "AgentTask"("squadId");
CREATE INDEX "AgentTask_parentTaskId_idx" ON "AgentTask"("parentTaskId");
CREATE INDEX "AgentTask_availableAt_idx" ON "AgentTask"("availableAt");

CREATE UNIQUE INDEX "AgentDelegation_childTaskId_key" ON "AgentDelegation"("childTaskId");
CREATE INDEX "AgentDelegation_organizationId_status_idx" ON "AgentDelegation"("organizationId", "status");
CREATE INDEX "AgentDelegation_fromAgentId_idx" ON "AgentDelegation"("fromAgentId");
CREATE INDEX "AgentDelegation_toAgentId_idx" ON "AgentDelegation"("toAgentId");
CREATE INDEX "AgentDelegation_parentTaskId_idx" ON "AgentDelegation"("parentTaskId");
CREATE INDEX "AgentDelegation_sourceRunId_idx" ON "AgentDelegation"("sourceRunId");

CREATE INDEX "AgentRun_agentId_idx" ON "AgentRun"("agentId");
CREATE INDEX "AgentRun_agentTaskId_idx" ON "AgentRun"("agentTaskId");

ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Skill" ADD CONSTRAINT "Skill_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Squad" ADD CONSTRAINT "Squad_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_leaderAgentId_fkey"
  FOREIGN KEY ("leaderAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_squadId_fkey"
  FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workItemId_fkey"
  FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_squadId_fkey"
  FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_fromAgentId_fkey"
  FOREIGN KEY ("fromAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_toAgentId_fkey"
  FOREIGN KEY ("toAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_childTaskId_fkey"
  FOREIGN KEY ("childTaskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_sourceRunId_fkey"
  FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentTaskId_fkey"
  FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Structural invariants that must survive future API/worker entry points.
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_maxConcurrentTasks_check"
  CHECK ("maxConcurrentTasks" BETWEEN 1 AND 50);

ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_priority_check"
  CHECK ("priority" BETWEEN 0 AND 100);
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_attempt_check"
  CHECK ("attempt" >= 1 AND "maxAttempts" >= 1);
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_parent_not_self_check"
  CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "id");

ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_actor_shape_check"
  CHECK (
    ("memberType" = 'AGENT' AND "agentId" IS NOT NULL AND "userId" IS NULL)
    OR
    ("memberType" = 'HUMAN' AND "userId" IS NOT NULL AND "agentId" IS NULL)
  );

ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_distinct_agents_check"
  CHECK ("fromAgentId" <> "toAgentId");
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_distinct_tasks_check"
  CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "childTaskId");
