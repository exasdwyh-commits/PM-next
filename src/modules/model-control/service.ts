import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { isOrgAdmin } from "@/modules/identity/admin";
import type { SessionContext } from "@/modules/identity/session";
import type {
  ModelCapability,
  ModelPolicy,
  ModelProfile,
  ModelTaskClass,
} from "@/modules/model-gateway";
import {
  AGENT_MODEL_BINDING_PRESETS,
  MODEL_CAPABILITIES,
  MODEL_POLICY_PRESETS,
  MODEL_PROFILE_PRESETS,
  MODEL_TASK_CLASSES,
} from "./presets";

const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const taskClassSet = new Set<string>(MODEL_TASK_CLASSES);
const capabilitySet = new Set<string>(MODEL_CAPABILITIES);

function assertKey(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!KEY_RE.test(text)) {
    throw new UnprocessableEntityError(label + " 仅允许 2-64 位小写字母、数字、-、_");
  }
  return text;
}

function assertText(value: unknown, label: string, max = 160): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new UnprocessableEntityError(label + " 不能为空");
  if (text.length > max) throw new UnprocessableEntityError(label + " 过长");
  return text;
}

function assertTaskClass(value: unknown): ModelTaskClass {
  const text = typeof value === "string" ? value.trim() : "";
  if (!taskClassSet.has(text)) {
    throw new UnprocessableEntityError("未知 taskClass");
  }
  return text as ModelTaskClass;
}

function assertCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new UnprocessableEntityError("capabilities 至少需要一项");
  }
  const normalized = [...new Set(value.map((item) => String(item).trim()))];
  if (normalized.some((item) => !capabilitySet.has(item))) {
    throw new UnprocessableEntityError("capabilities 包含未知能力");
  }
  return normalized as ModelCapability[];
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function jsonCandidates(
  value: Prisma.JsonValue
): Array<{ profileKey: string; priority: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.profileKey !== "string" || typeof row.priority !== "number") return [];
    return [{ profileKey: row.profileKey, priority: row.priority }];
  });
}

async function assertAdmin(session: SessionContext) {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError("Only organization admins can manage model configuration");
  }
}

export async function getModelControlOverview(session: SessionContext) {
  const [profiles, policies, agents, bindings, canManage] = await Promise.all([
    prisma.modelProfileConfig.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ isPreset: "desc" }, { key: "asc" }],
    }),
    prisma.modelPolicyConfig.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ isPreset: "desc" }, { taskClass: "asc" }, { key: "asc" }],
    }),
    prisma.agent.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, roleKey: true, status: true },
    }),
    prisma.agentModelPolicyBinding.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ agentId: "asc" }, { taskClass: "asc" }],
      include: { agent: { select: { code: true, name: true } } },
    }),
    isOrgAdmin(session),
  ]);

  return {
    profiles,
    policies,
    agents,
    bindings,
    canManage,
    taskClasses: MODEL_TASK_CLASSES,
    capabilities: MODEL_CAPABILITIES,
    presetCounts: {
      profiles: MODEL_PROFILE_PRESETS.length,
      policies: MODEL_POLICY_PRESETS.length,
      bindings: AGENT_MODEL_BINDING_PRESETS.length,
    },
  };
}

export async function installRecommendedModelControlPresets(session: SessionContext) {
  await assertAdmin(session);

  return prisma.$transaction(async (tx) => {
    for (const preset of MODEL_PROFILE_PRESETS) {
      await tx.modelProfileConfig.upsert({
        where: {
          organizationId_key: {
            organizationId: session.organizationId,
            key: preset.key,
          },
        },
        create: {
          organizationId: session.organizationId,
          key: preset.key,
          displayName: preset.displayName,
          description: preset.description,
          provider: preset.provider,
          modelId: preset.modelId,
          capabilities: preset.capabilities as Prisma.InputJsonValue,
          locality: preset.locality,
          health: "HEALTHY",
          enabled: preset.enabled,
          qualityTier: preset.qualityTier,
          latencyTier: preset.latencyTier,
          costTier: preset.costTier,
          contextWindow: preset.contextWindow,
          dataPolicyNote: preset.dataPolicyNote,
          isPreset: true,
        },
        update: {
          isPreset: true,
          description: preset.description,
          dataPolicyNote: preset.dataPolicyNote,
        },
      });
    }

    for (const preset of MODEL_POLICY_PRESETS) {
      await tx.modelPolicyConfig.upsert({
        where: {
          organizationId_key: {
            organizationId: session.organizationId,
            key: preset.key,
          },
        },
        create: {
          organizationId: session.organizationId,
          key: preset.key,
          name: preset.name,
          description: preset.description,
          version: preset.version,
          taskClass: preset.taskClass,
          candidates: preset.candidates as Prisma.InputJsonValue,
          requiredCapabilities: preset.requiredCapabilities as Prisma.InputJsonValue,
          cloudAllowed: preset.cloudAllowed,
          maxContextRequirement: preset.maxContextRequirement,
          isPreset: true,
        },
        update: {
          isPreset: true,
          description: preset.description,
        },
      });
    }

    const agents = await tx.agent.findMany({
      where: {
        organizationId: session.organizationId,
        code: { in: AGENT_MODEL_BINDING_PRESETS.map((item) => item.agentCode) },
      },
      select: { id: true, code: true },
    });
    const agentByCode = new Map(agents.map((agent) => [agent.code, agent]));

    let bindingCount = 0;
    for (const preset of AGENT_MODEL_BINDING_PRESETS) {
      const agent = agentByCode.get(preset.agentCode);
      if (!agent) continue;
      await tx.agentModelPolicyBinding.upsert({
        where: {
          agentId_taskClass: {
            agentId: agent.id,
            taskClass: preset.taskClass,
          },
        },
        create: {
          organizationId: session.organizationId,
          agentId: agent.id,
          taskClass: preset.taskClass,
          policyKey: preset.policyKey,
        },
        update: {},
      });
      bindingCount += 1;
    }

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "MODEL_CONTROL_PRESETS_INSTALLED",
      objectType: "Organization",
      objectId: session.organizationId,
      summary: "安装 Model Control Center 官方推荐模板",
      details: {
        profileCount: MODEL_PROFILE_PRESETS.length,
        policyCount: MODEL_POLICY_PRESETS.length,
        bindingCount,
      } as Prisma.InputJsonValue,
    });

    return {
      profileCount: MODEL_PROFILE_PRESETS.length,
      policyCount: MODEL_POLICY_PRESETS.length,
      bindingCount,
    };
  });
}

export async function saveModelProfile(
  session: SessionContext,
  input: {
    key?: unknown;
    displayName?: unknown;
    description?: unknown;
    provider?: unknown;
    modelId?: unknown;
    capabilities?: unknown;
    locality?: unknown;
    health?: unknown;
    enabled?: unknown;
    qualityTier?: unknown;
    latencyTier?: unknown;
    costTier?: unknown;
    contextWindow?: unknown;
    dataPolicyNote?: unknown;
  }
) {
  await assertAdmin(session);

  const key = assertKey(input.key, "profile key");
  const displayName = assertText(input.displayName, "显示名称");
  const provider = assertText(input.provider, "provider", 120);
  const modelId = assertText(input.modelId, "modelId", 160);
  const capabilities = assertCapabilities(input.capabilities);
  const locality = input.locality === "LOCAL" ? "LOCAL" : input.locality === "CLOUD" ? "CLOUD" : null;
  if (!locality) throw new UnprocessableEntityError("locality 必须是 CLOUD 或 LOCAL");

  const qualityTier = ["FAST", "BALANCED", "FRONTIER"].includes(String(input.qualityTier))
    ? String(input.qualityTier)
    : null;
  const latencyTier = ["FAST", "NORMAL", "SLOW"].includes(String(input.latencyTier))
    ? String(input.latencyTier)
    : null;
  const costTier = ["FREE", "LOW", "STANDARD", "PREMIUM", "FIXED_LOCAL"].includes(String(input.costTier))
    ? String(input.costTier)
    : null;
  if (!qualityTier || !latencyTier || !costTier) {
    throw new UnprocessableEntityError("qualityTier / latencyTier / costTier 配置不合法");
  }

  const enabled = input.enabled === true;
  if (enabled && (provider === "UNCONFIGURED" || modelId === "UNCONFIGURED")) {
    throw new UnprocessableEntityError("未配置 provider/modelId 的模型位不能启用");
  }

  const contextWindow =
    input.contextWindow === null || input.contextWindow === undefined || input.contextWindow === ""
      ? null
      : Number(input.contextWindow);
  if (contextWindow !== null && (!Number.isInteger(contextWindow) || contextWindow <= 0)) {
    throw new UnprocessableEntityError("contextWindow 必须是正整数");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.modelProfileConfig.findUnique({
      where: {
        organizationId_key: { organizationId: session.organizationId, key },
      },
      select: { isPreset: true },
    });
    const profile = await tx.modelProfileConfig.upsert({
      where: {
        organizationId_key: { organizationId: session.organizationId, key },
      },
      create: {
        organizationId: session.organizationId,
        key,
        displayName,
        description: typeof input.description === "string" ? input.description.trim() || null : null,
        provider,
        modelId,
        capabilities: capabilities as Prisma.InputJsonValue,
        locality,
        health: ["HEALTHY", "DEGRADED", "UNAVAILABLE"].includes(String(input.health))
          ? String(input.health)
          : "HEALTHY",
        enabled,
        qualityTier,
        latencyTier,
        costTier,
        contextWindow,
        dataPolicyNote:
          typeof input.dataPolicyNote === "string" ? input.dataPolicyNote.trim() || null : null,
        isPreset: false,
      },
      update: {
        displayName,
        description: typeof input.description === "string" ? input.description.trim() || null : null,
        provider,
        modelId,
        capabilities: capabilities as Prisma.InputJsonValue,
        locality,
        health: ["HEALTHY", "DEGRADED", "UNAVAILABLE"].includes(String(input.health))
          ? String(input.health)
          : "HEALTHY",
        enabled,
        qualityTier,
        latencyTier,
        costTier,
        contextWindow,
        dataPolicyNote:
          typeof input.dataPolicyNote === "string" ? input.dataPolicyNote.trim() || null : null,
        isPreset: existing?.isPreset ?? false,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "MODEL_PROFILE_SAVED",
      objectType: "ModelProfileConfig",
      objectId: profile.id,
      summary: "保存模型 Profile：" + key,
      details: {
        key,
        provider,
        modelId,
        enabled,
        locality,
        capabilities,
      } as Prisma.InputJsonValue,
    });
    return profile;
  });
}

export async function saveModelPolicy(
  session: SessionContext,
  input: {
    key?: unknown;
    name?: unknown;
    description?: unknown;
    version?: unknown;
    taskClass?: unknown;
    candidates?: unknown;
    requiredCapabilities?: unknown;
    cloudAllowed?: unknown;
    maxContextRequirement?: unknown;
  }
) {
  await assertAdmin(session);
  const key = assertKey(input.key, "policy key");
  const name = assertText(input.name, "策略名称");
  const version = assertText(input.version ?? "v1", "策略版本", 80);
  const taskClass = assertTaskClass(input.taskClass);
  const requiredCapabilities = assertCapabilities(input.requiredCapabilities);

  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new UnprocessableEntityError("策略至少需要一个候选 Profile");
  }
  const candidates = input.candidates.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UnprocessableEntityError("候选 Profile 格式错误");
    }
    const row = item as Record<string, unknown>;
    const profileKey = assertKey(row.profileKey, "profileKey");
    const priority = Number(row.priority ?? (index + 1) * 10);
    if (!Number.isInteger(priority) || priority < 0 || priority > 10000) {
      throw new UnprocessableEntityError("候选优先级不合法");
    }
    return { profileKey, priority };
  });

  if (new Set(candidates.map((item) => item.profileKey)).size !== candidates.length) {
    throw new UnprocessableEntityError("同一策略不能重复引用 Profile");
  }

  const existingProfiles = await prisma.modelProfileConfig.findMany({
    where: {
      organizationId: session.organizationId,
      key: { in: candidates.map((item) => item.profileKey) },
    },
    select: { key: true, locality: true },
  });
  if (existingProfiles.length !== candidates.length) {
    throw new UnprocessableEntityError("策略引用了不存在的 Profile");
  }

  const cloudAllowed = input.cloudAllowed !== false;
  if (!cloudAllowed && existingProfiles.some((profile) => profile.locality !== "LOCAL")) {
    throw new UnprocessableEntityError("cloudAllowed=false 的策略只能引用 LOCAL Profile");
  }

  const maxContextRequirement =
    input.maxContextRequirement === null ||
    input.maxContextRequirement === undefined ||
    input.maxContextRequirement === ""
      ? null
      : Number(input.maxContextRequirement);
  if (
    maxContextRequirement !== null &&
    (!Number.isInteger(maxContextRequirement) || maxContextRequirement <= 0)
  ) {
    throw new UnprocessableEntityError("maxContextRequirement 必须是正整数");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.modelPolicyConfig.findUnique({
      where: {
        organizationId_key: { organizationId: session.organizationId, key },
      },
      select: { isPreset: true },
    });
    const policy = await tx.modelPolicyConfig.upsert({
      where: {
        organizationId_key: { organizationId: session.organizationId, key },
      },
      create: {
        organizationId: session.organizationId,
        key,
        name,
        description: typeof input.description === "string" ? input.description.trim() || null : null,
        version,
        taskClass,
        candidates: candidates as Prisma.InputJsonValue,
        requiredCapabilities: requiredCapabilities as Prisma.InputJsonValue,
        cloudAllowed,
        maxContextRequirement,
        isPreset: false,
      },
      update: {
        name,
        description: typeof input.description === "string" ? input.description.trim() || null : null,
        version,
        taskClass,
        candidates: candidates as Prisma.InputJsonValue,
        requiredCapabilities: requiredCapabilities as Prisma.InputJsonValue,
        cloudAllowed,
        maxContextRequirement,
        isPreset: existing?.isPreset ?? false,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "MODEL_POLICY_SAVED",
      objectType: "ModelPolicyConfig",
      objectId: policy.id,
      summary: "保存模型策略：" + key,
      details: {
        key,
        version,
        taskClass,
        candidates,
        requiredCapabilities,
        cloudAllowed,
      } as Prisma.InputJsonValue,
    });
    return policy;
  });
}

export async function bindAgentModelPolicy(
  session: SessionContext,
  input: { agentId?: unknown; taskClass?: unknown; policyKey?: unknown }
) {
  await assertAdmin(session);
  const agentId = assertText(input.agentId, "agentId", 120);
  const taskClass = assertTaskClass(input.taskClass);
  const policyKey = assertKey(input.policyKey, "policyKey");

  const [agent, policy] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: agentId, organizationId: session.organizationId },
      select: { id: true, code: true, name: true },
    }),
    prisma.modelPolicyConfig.findUnique({
      where: {
        organizationId_key: { organizationId: session.organizationId, key: policyKey },
      },
      select: { key: true, taskClass: true },
    }),
  ]);
  if (!agent) throw new NotFoundError("Agent not found");
  if (!policy) throw new UnprocessableEntityError("Policy 不存在");
  if (policy.taskClass !== taskClass) {
    throw new UnprocessableEntityError("Agent 绑定的 taskClass 必须与 Policy taskClass 一致");
  }

  return prisma.$transaction(async (tx) => {
    const binding = await tx.agentModelPolicyBinding.upsert({
      where: { agentId_taskClass: { agentId, taskClass } },
      create: {
        organizationId: session.organizationId,
        agentId,
        taskClass,
        policyKey,
      },
      update: { policyKey },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AGENT_MODEL_POLICY_BOUND",
      objectType: "Agent",
      objectId: agentId,
      summary: "绑定 Agent 模型策略：" + agent.code + " / " + taskClass,
      details: { policyKey, taskClass } as Prisma.InputJsonValue,
    });
    return binding;
  });
}

export async function resolveGatewayPolicyForAgent(params: {
  organizationId: string;
  agentId: string;
  taskClass: ModelTaskClass;
}): Promise<{ policy: ModelPolicy; profiles: ModelProfile[] }> {
  const binding = await prisma.agentModelPolicyBinding.findFirst({
    where: {
      organizationId: params.organizationId,
      agentId: params.agentId,
      taskClass: params.taskClass,
    },
  });
  if (!binding) {
    throw new UnprocessableEntityError("当前 Agent 未配置该任务类型的模型策略");
  }

  const policyRow = await prisma.modelPolicyConfig.findUnique({
    where: {
      organizationId_key: {
        organizationId: params.organizationId,
        key: binding.policyKey,
      },
    },
  });
  if (!policyRow || policyRow.taskClass !== params.taskClass) {
    throw new UnprocessableEntityError("模型策略绑定已失效或 taskClass 不匹配");
  }

  const candidates = jsonCandidates(policyRow.candidates);
  const profileRows = await prisma.modelProfileConfig.findMany({
    where: {
      organizationId: params.organizationId,
      key: { in: candidates.map((item) => item.profileKey) },
    },
  });
  const profileByKey = new Map(profileRows.map((profile) => [profile.key, profile]));

  const profiles: ModelProfile[] = candidates.flatMap((candidate) => {
    const row = profileByKey.get(candidate.profileKey);
    if (!row) return [];
    return [{
      id: row.key,
      provider: row.provider,
      modelId: row.modelId,
      displayName: row.displayName,
      capabilities: jsonStringArray(row.capabilities) as ModelCapability[],
      locality: row.locality as ModelProfile["locality"],
      health: row.health as ModelProfile["health"],
      enabled: row.enabled,
      qualityTier: row.qualityTier as ModelProfile["qualityTier"],
      latencyTier: row.latencyTier as ModelProfile["latencyTier"],
      costTier: row.costTier as ModelProfile["costTier"],
      contextWindow: row.contextWindow,
      dataPolicyNote: row.dataPolicyNote,
    }];
  });

  const policy: ModelPolicy = {
    id: policyRow.key,
    version: policyRow.version,
    taskClass: policyRow.taskClass as ModelTaskClass,
    candidates: candidates.map((candidate) => ({
      profileId: candidate.profileKey,
      priority: candidate.priority,
    })),
    requiredCapabilities: jsonStringArray(policyRow.requiredCapabilities) as ModelCapability[],
    cloudAllowed: policyRow.cloudAllowed,
    maxContextRequirement: policyRow.maxContextRequirement,
  };

  return { policy, profiles };
}
