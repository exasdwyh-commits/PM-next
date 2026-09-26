import prisma from "@/shared/db";
import { UnprocessableEntityError } from "@/shared/errors";
import { isProviderRuntimeConfigured } from "@/modules/model-gateway/provider-runtime";
import type {
  ModelCapability,
  ModelPolicy,
  ModelProfile,
  ModelTaskClass,
} from "@/modules/model-gateway";

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function resolveExplicitConversationModel(input: {
  organizationId: string;
  profileKey: string;
  taskClass: ModelTaskClass;
}) {
  const row = await prisma.modelProfileConfig.findFirst({
    where: {
      organizationId: input.organizationId,
      key: input.profileKey,
      enabled: true,
    },
  });

  if (!row) {
    throw new UnprocessableEntityError("所选模型不存在或未启用");
  }
  if (row.health === "UNAVAILABLE") {
    throw new UnprocessableEntityError("所选模型当前不可用");
  }
  if (!isProviderRuntimeConfigured(row.provider)) {
    throw new UnprocessableEntityError("所选模型 Provider 尚未配置运行时凭据");
  }

  const profile: ModelProfile = {
    id: row.key,
    provider: row.provider,
    modelId: row.modelId,
    displayName: row.displayName,
    capabilities: stringList(row.capabilities) as ModelCapability[],
    locality: row.locality as ModelProfile["locality"],
    health: row.health as ModelProfile["health"],
    enabled: row.enabled,
    qualityTier: row.qualityTier as ModelProfile["qualityTier"],
    latencyTier: row.latencyTier as ModelProfile["latencyTier"],
    costTier: row.costTier as ModelProfile["costTier"],
    contextWindow: row.contextWindow,
    dataPolicyNote: row.dataPolicyNote,
  };

  const policy: ModelPolicy = {
    id: `conversation-profile:${row.key}`,
    version: "conversation/v1",
    taskClass: input.taskClass,
    candidates: [{ profileId: row.key, priority: 1 }],
    requiredCapabilities: [],
    cloudAllowed: true,
    maxContextRequirement: null,
  };

  return { profile, policy };
}
