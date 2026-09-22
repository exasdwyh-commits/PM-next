import { isModelCoolingDown } from "./health";
import type {
  ModelCapability,
  ModelGatewayRequest,
  ModelHealthSnapshot,
  ModelPolicy,
  ModelProfile,
  ModelRouteDecision,
  ModelRouteSkip,
} from "./types";

export class ModelRoutingError extends Error {
  constructor(
    message: string,
    public readonly skipped: ModelRouteSkip[] = []
  ) {
    super(message);
    this.name = "ModelRoutingError";
  }
}

function missingCapabilities(
  profile: ModelProfile,
  required: ModelCapability[]
): ModelCapability[] {
  const available = new Set(profile.capabilities);
  return required.filter((capability) => !available.has(capability));
}

function effectiveRequiredCapabilities(
  policy: ModelPolicy,
  request: ModelGatewayRequest
): ModelCapability[] {
  return [...new Set([
    ...policy.requiredCapabilities,
    ...(request.requiredCapabilities ?? []),
  ])];
}

export function orderedPolicyProfiles(
  policy: ModelPolicy,
  profiles: ModelProfile[]
): ModelProfile[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return [...policy.candidates]
    .sort((a, b) => a.priority - b.priority)
    .map((candidate) => byId.get(candidate.profileId))
    .filter((profile): profile is ModelProfile => !!profile);
}

export function selectModelRoute(
  policy: ModelPolicy,
  profiles: ModelProfile[],
  request: ModelGatewayRequest,
  excludedProfileIds: Set<string> = new Set(),
  healthSnapshots: ReadonlyMap<string, ModelHealthSnapshot> = new Map(),
  nowMs: number = Date.now()
): ModelRouteDecision {
  if (policy.taskClass !== request.taskClass) {
    throw new ModelRoutingError(
      `模型策略 ${policy.id} 不适用于任务类型 ${request.taskClass}`
    );
  }

  const required = effectiveRequiredCapabilities(policy, request);
  const cloudAllowed = request.cloudAllowed ?? policy.cloudAllowed;
  const minimumContextWindow = Math.max(
    request.minimumContextWindow ?? 0,
    policy.maxContextRequirement ?? 0
  );

  const skipped: ModelRouteSkip[] = [];

  for (const profile of orderedPolicyProfiles(policy, profiles)) {
    if (excludedProfileIds.has(profile.id)) {
      skipped.push({ profileId: profile.id, reason: "本次执行已尝试过该模型" });
      continue;
    }
    const dynamicHealth = healthSnapshots.get(profile.id);
    if (isModelCoolingDown(dynamicHealth, nowMs)) {
      skipped.push({
        profileId: profile.id,
        reason: `模型冷却中，直到 ${new Date(
          dynamicHealth!.cooldownUntilMs!
        ).toISOString()}`,
      });
      continue;
    }
    if (!profile.enabled) {
      skipped.push({ profileId: profile.id, reason: "模型已停用" });
      continue;
    }
    if (profile.health === "UNAVAILABLE") {
      skipped.push({ profileId: profile.id, reason: "模型当前不可用" });
      continue;
    }
    if (!cloudAllowed && profile.locality === "CLOUD") {
      skipped.push({ profileId: profile.id, reason: "本次任务禁止云端模型" });
      continue;
    }

    const missing = missingCapabilities(profile, required);
    if (missing.length > 0) {
      skipped.push({
        profileId: profile.id,
        reason: `缺少能力：${missing.join(", ")}`,
      });
      continue;
    }

    if (
      minimumContextWindow > 0 &&
      (profile.contextWindow == null || profile.contextWindow < minimumContextWindow)
    ) {
      skipped.push({
        profileId: profile.id,
        reason: `上下文窗口不足：需要至少 ${minimumContextWindow}`,
      });
      continue;
    }

    return { selected: profile, skipped };
  }

  throw new ModelRoutingError("没有满足当前策略与任务约束的可用模型", skipped);
}
