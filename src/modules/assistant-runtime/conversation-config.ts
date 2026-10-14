import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { assertObjectInput } from "@/shared/input-validation";
import { isProviderRuntimeConfigured } from "@/modules/model-gateway/provider-runtime";
import {
  KERN_CAPABILITY_CATALOG,
  type KernCapabilityKey,
} from "./capabilities/catalog";
import { loadCapabilitySkills } from "./capabilities/skill-registry";

export type KernDelegationMode = "auto" | "full";

export interface KernConversationRuntimeConfig {
  version: "kern-conversation-config/v1";
  modelProfileKey: string | null;
  advisorCodes: string[] | null;
  skillKeys: string[] | null;
  capabilityKeys: KernCapabilityKey[] | null;
  /**
   * 授权档位：
   * - `auto`（默认）：常规协作，需要用户拍板的地方照常问。
   * - `full`：全委托——用户把本轮取舍权交给 Kern，不再追问确认，可直接按最佳判断产出；
   *   被补全的缺失细节必须以「假设」标注，不得写成既定事实。
   * 只影响提示词语气，不放宽任何工具/权限边界。
   */
  delegationMode: KernDelegationMode;
  /**
   * 文件式能力包（`capabilities/<域>/<名称>/SKILL.md`）的 id，形如 `<域>.<名称>`。
   * 与 `capabilityKeys`（原生能力）是两个命名空间：前者圈「用哪套做法」，后者圈「开哪些功能」。
   * 历史配置缺这个字段时由 `stringListOrNull` 归一为 null（= 不限，走自动识别）。
   */
  capabilityPackIds: string[] | null;
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
  /**
   * 文件式能力包（`capabilities/<域>/<名称>/SKILL.md`），对应 `config.capabilityPackIds`。
   * 与 `capabilities`（原生能力开关）是两个命名空间：这里选的是「这类活用哪套做法」。
   * 选中后对话走 EXPLICIT 档，不再靠关键词猜。
   */
  capabilityPacks: KernConversationControlOption[];
}

export const DEFAULT_KERN_CONVERSATION_RUNTIME_CONFIG: KernConversationRuntimeConfig = {
  version: "kern-conversation-config/v1",
  modelProfileKey: null,
  advisorCodes: null,
  skillKeys: null,
  capabilityKeys: null,
  capabilityPackIds: null,
  delegationMode: "auto",
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
  const capabilityPackIds = stringListOrNull(raw.capabilityPackIds);
  // 授权档位只有两档；历史配置缺字段或写坏值一律落回 auto，不阻断对话。
  const delegationMode: KernDelegationMode = raw.delegationMode === "full" ? "full" : "auto";
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
    capabilityPackIds,
    delegationMode,
  };
}

export async function validateKernConversationRuntimeConfig(
  session: SessionContext,
  value: unknown
): Promise<KernConversationRuntimeConfig> {
  // Normalization tolerates stored legacy data. User writes must fail before
  // normalization can discard a malformed selection and reset it to AUTO.
  assertObjectInput(value);
  if (value.version !== undefined && value.version !== "kern-conversation-config/v1") {
    throw new UnprocessableEntityError("会话配置版本不受支持");
  }
  if (value.modelProfileKey !== undefined && value.modelProfileKey !== null && typeof value.modelProfileKey !== "string") {
    throw new UnprocessableEntityError("模型选择必须为文本或 null");
  }
  for (const key of ["advisorCodes", "skillKeys", "capabilityKeys", "capabilityPackIds"] as const) {
    const selection = value[key];
    if (selection !== undefined && selection !== null && (!Array.isArray(selection) || selection.some((item) => typeof item !== "string" || !item.trim()))) {
      throw new UnprocessableEntityError(`${key} 必须为非空文本数组或 null`, {
        [key]: ["必须为非空文本数组或 null"],
      });
    }
  }
  const capabilities = value.capabilityKeys as string[] | null | undefined;
  const allowed = new Set<string>(KERN_CAPABILITY_CATALOG.map((item) => item.key));
  if (capabilities?.some((key) => !allowed.has(key.trim()))) {
    throw new UnprocessableEntityError("功能选择包含不支持的能力");
  }
  // 能力包是仓库内闭合集合：点名不存在的包直接报错，别静默落库再在选择器里被丢弃。
  const packIds = value.capabilityPackIds as string[] | null | undefined;
  if (packIds?.length) {
    const availablePacks = new Set(loadCapabilitySkills().skills.map((skill) => skill.id));
    const unknown = packIds.map((id) => id.trim()).filter((id) => !availablePacks.has(id));
    if (unknown.length) {
      throw new UnprocessableEntityError("能力包选择包含不存在或未启用的包", {
        capabilityPackIds: unknown,
      });
    }
  }
  // 授权档位：写坏值直接报错，不要悄悄回落成 auto（用户会以为「全委托」已生效）。
  if (
    value.delegationMode !== undefined &&
    value.delegationMode !== "auto" &&
    value.delegationMode !== "full"
  ) {
    throw new UnprocessableEntityError("授权档位只能是 auto 或 full");
  }
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
    // 只列能真正加载出来的包：加载失败的进 diagnostics，不该出现在可选清单里。
    capabilityPacks: loadCapabilitySkills()
      .skills.filter((skill) => skill.enabled && !skill.error)
      .map((skill) => ({
        key: skill.id,
        label: skill.label,
        description: skill.description,
        meta: skill.domain,
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
