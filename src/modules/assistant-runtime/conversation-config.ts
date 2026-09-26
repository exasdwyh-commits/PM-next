import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { isProviderRuntimeConfigured } from "@/modules/model-gateway/provider-runtime";
import {
  KERN_CAPABILITY_CATALOG,
  type KernCapabilityKey,
} from "./capabilities/catalog";

export interface KernConversationRuntimeConfig {
  version: "kern-conversation-config/v1";
  modelProfileKey: string | null;
  advisorCodes: string[] | null;
  skillKeys: string[] | null;
  capabilityKeys: KernCapabilityKey[] | null;
}

export interface KernConversationControlOption {
  key: string;
  label: string;
  description: string;
  meta?: string | null;
}

export interface KernConversationControlState {
  config: KernConversationRuntimeConfig;
  models: KernConversationControlOption[];
  advisors: KernConversationControlOption[];
  skills: KernConversationControlOption[];
  capabilities: KernConversationControlOption[];
}

export const DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG: KernConversationRuntimeConfig = {
  version: "kern-conversation-config/v1",
  modelProfileKey: null,
  advisorCodes: null,
  skillKeys: null,
  capabilityKeys: null,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringListOrNull(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

export function normalizeKernConversationRuntimeConfig(
  value: unknown
): KernConversationRuntimeConfig {
  const raw = record(value);
  const modelProfileKey =
    typeof raw.modelProfileKey === "string" && raw.modelProfileKey.trim()
      ? raw.modelProfileKey.trim()
      : null;
  const advisorCodes = stringListOrNull(raw.advisorCodes);
  const skillKeys = stringListOrNull(raw.skillKeys);
  const requestedCapabilities = stringListOrNull(raw.capabilityKeys);
  const allowed = new Set(KERN_CAPABILITY_CATALOG.map((item) => item.key));
  const capabilityKeys =
    requestedCapabilities === null
      ? null
      : requestedCapabilities.filter(
          (item): item is KernCapabilityKey =>
            allowed.has(item as KernCapabilityKey)
        );

  return {
    version: "kern-conversation-config/v1",
    modelProfileKey,
    advisorCodes,
    skillKeys,
    capabilityKeys,
  };
}

export async function validateKernConversationRuntimeConfig(
  session: SessionContext,
  value: unknown
): Promise<KernConversationRuntimeConfig> {
  const config = normalizeKernConversationRuntimeConfig(value);

  const [profile, advisors, skills] = await Promise.all([
    config.modelProfileKey
      ? prisma.modelProfileConfig.findFirst({
          where: {
            organizationId: session.organizationId,
            key: config.modelProfileKey,
            enabled: true,
          },
          select: { key: true, provider: true, health: true },
        })
      : Promise.resolve(null),
    config.advisorCodes
      ? prisma.agent.findMany({
          where: {
            organizationId: session.organizationId,
            code: { in: config.advisorCodes },
            status: "ACTIVE",
          },
          select: { code: true },
        })
      : Promise.resolve([]),
    config.skillKeys
      ? prisma.skill.findMany({
          where: {
            organizationId: session.organizationId,
            key: { in: config.skillKeys },
            status: "ACTIVE",
          },
          select: { key: true },
        })
      : Promise.resolve([]),
  ]);

  if (config.modelProfileKey) {
    if (!profile) {
      throw new UnprocessableEntityError("所选模型不存在或未启用");
    }
    if (profile.health === "UNAVAILABLE") {
      throw new UnprocessableEntityError("所选模型当前不可用");
    }
    if (!isProviderRuntimeConfigured(profile.provider)) {
      throw new UnprocessableEntityError("所选模型的 Provider 尚未配置运行时凭据");
    }
  }

  if (
    config.advisorCodes &&
    advisors.length !== new Set(config.advisorCodes).size
  ) {
    throw new UnprocessableEntityError("顾问选择包含不存在或未启用的 Agent");
  }

  if (
    config.skillKeys &&
    skills.length !== new Set(config.skillKeys).size
  ) {
    throw new UnprocessableEntityError("技能选择包含不存在或未启用的 Skill");
  }

  return config;
}

export async function updateKernConversationRuntimeConfig(
  session: SessionContext,
  conversationId: string,
  value: unknown
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      organizationId: session.organizationId,
      ownerId: session.userId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!conversation) {
    // Same contract as conversation messages: not yours → 404 (no existence leak).
    throw new NotFoundError("Conversation not found");
  }

  const config = await validateKernConversationRuntimeConfig(session, value);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { runtimeConfig: config as unknown as Prisma.InputJsonValue },
  });
  return config;
}

export async function getKernConversationControlState(
  session: SessionContext,
  runtimeConfig?: unknown
): Promise<KernConversationControlState> {
  const [profiles, agents, skills] = await Promise.all([
    prisma.modelProfileConfig.findMany({
      where: {
        organizationId: session.organizationId,
        enabled: true,
        health: { not: "UNAVAILABLE" },
      },
      orderBy: [{ qualityTier: "asc" }, { displayName: "asc" }],
      select: {
        key: true,
        displayName: true,
        description: true,
        provider: true,
        modelId: true,
        qualityTier: true,
      },
    }),
    prisma.agent.findMany({
      where: {
        organizationId: session.organizationId,
        status: "ACTIVE",
        code: { not: "desktop_operator" },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        code: true,
        name: true,
        roleKey: true,
        description: true,
      },
    }),
    prisma.skill.findMany({
      where: {
        organizationId: session.organizationId,
        status: "ACTIVE",
      },
      orderBy: { name: "asc" },
      select: {
        key: true,
        name: true,
        description: true,
      },
    }),
  ]);

  return {
    config: normalizeKernConversationRuntimeConfig(runtimeConfig),
    models: profiles
      .filter((profile) => isProviderRuntimeConfigured(profile.provider))
      .map((profile) => ({
        key: profile.key,
        label: profile.displayName,
        description: profile.description || profile.modelId,
        meta: `${profile.qualityTier} · ${profile.provider}`,
      })),
    advisors: agents.map((agent) => ({
      key: agent.code,
      label: agent.code === "hermes_pm" ? "Kern" : agent.name,
      description: agent.description || agent.roleKey,
      meta: agent.roleKey,
    })),
    skills: skills.map((skill) => ({
      key: skill.key,
      label: skill.name,
      description: skill.description || "Kern Skill",
    })),
    capabilities: KERN_CAPABILITY_CATALOG.map((capability) => ({
      key: capability.key,
      label: capability.label,
      description: capability.description,
    })),
  };
}

export async function resolveKernConversationRuntimeSelection(
  session: SessionContext,
  value: unknown
) {
  const config = normalizeKernConversationRuntimeConfig(value);
  const [model, advisors, skills] = await Promise.all([
    config.modelProfileKey
      ? prisma.modelProfileConfig.findFirst({
          where: {
            organizationId: session.organizationId,
            key: config.modelProfileKey,
            enabled: true,
          },
        })
      : Promise.resolve(null),
    config.advisorCodes
      ? prisma.agent.findMany({
          where: {
            organizationId: session.organizationId,
            code: { in: config.advisorCodes },
            status: "ACTIVE",
          },
          select: {
            id: true,
            code: true,
            name: true,
            roleKey: true,
            instructions: true,
          },
        })
      : Promise.resolve([]),
    config.skillKeys
      ? prisma.skill.findMany({
          where: {
            organizationId: session.organizationId,
            key: { in: config.skillKeys },
            status: "ACTIVE",
          },
          select: {
            key: true,
            name: true,
            instructions: true,
            allowedTools: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const advisorByCode = new Map(advisors.map((advisor) => [advisor.code, advisor]));
  const skillByKey = new Map(skills.map((skill) => [skill.key, skill]));

  return {
    config,
    model,
    advisors:
      config.advisorCodes === null
        ? []
        : config.advisorCodes.flatMap((code) => {
            const advisor = advisorByCode.get(code);
            return advisor ? [advisor] : [];
          }),
    skills:
      config.skillKeys === null
        ? []
        : config.skillKeys.flatMap((key) => {
            const skill = skillByKey.get(key);
            return skill ? [skill] : [];
          }),
  };
}

export function buildKernConversationSelectionPrompt(
  selection: Awaited<ReturnType<typeof resolveKernConversationRuntimeSelection>>
): string | null {
  const sections: string[] = [];

  if (selection.advisors.length > 0) {
    sections.push(
      [
        "用户为本 Conversation 指定了以下顾问视角：",
        ...selection.advisors.map(
          (advisor) =>
            `- ${advisor.name} (${advisor.roleKey}): ${advisor.instructions}`
        ),
        "把这些专业职责用于本轮分析与综合；除非存在独立 AgentRun，不要声称这些顾问已经分别独立执行。",
      ].join("\n")
    );
  }

  if (selection.skills.length > 0) {
    sections.push(
      [
        "用户为本 Conversation 启用了以下 Skills：",
        ...selection.skills.map(
          (skill) => `- ${skill.name}: ${skill.instructions}`
        ),
        "Skill 只提供方法与约束，不扩大工具、权限或 Governance 授权。",
      ].join("\n")
    );
  }

  if (selection.config.capabilityKeys !== null) {
    sections.push(
      `本 Conversation 的功能范围已由用户限制为：${selection.config.capabilityKeys.join(", ") || "无额外功能"}。不得绕过该范围调用被关闭的 capability。`
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}
