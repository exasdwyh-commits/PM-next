import prisma from "@/shared/db";
import type { ModelTaskClass } from "@/modules/model-gateway";
import { hasEnabledPolicyCandidate } from "@/modules/model-gateway";
import { isProviderRuntimeConfigured } from "@/modules/model-gateway/provider-runtime";
import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import type { KernCollaborationPlanShadow } from "./collaboration-planner";
import {
  GENERIC_AGENT_CONTRACTS,
  chatDispatchableAgentCodes,
} from "@/modules/worker/generic-agent-contracts";

export type KernDispatchReadinessState =
  | "INLINE_READY"
  | "EXECUTOR_READY"
  | "REVIEW_REQUIRED"
  | "NO_CHAT_EXECUTOR"
  | "AGENT_UNAVAILABLE"
  | "MODEL_POLICY_MISSING"
  | "MODEL_PROFILE_DISABLED"
  | "PROVIDER_RUNTIME_MISSING";

export interface KernDispatchReadiness {
  version: "kern-dispatch-readiness/v1";
  eligible: boolean;
  state: KernDispatchReadinessState;
  executor: "INLINE" | "WORKER" | "NONE";
  agentCode: string | null;
  taskClass: ModelTaskClass | null;
  reason: string;
}

/**
 * Chat-dispatchable specialists are derived from the Generic Agent Executor
 * contract registry — adding an advisory agent is configuration, not a new
 * hard-coded branch. Every entry still needs an ACTIVE agent, an enabled model
 * policy and a configured provider runtime before it is EXECUTOR_READY.
 */
const CHAT_SPECIALIST_EXECUTION: Record<
  string,
  { taskClass: ModelTaskClass; executor: "WORKER" }
> = Object.fromEntries(
  chatDispatchableAgentCodes().map((code) => [
    code,
    { taskClass: GENERIC_AGENT_CONTRACTS[code].taskClass, executor: "WORKER" as const },
  ])
);

/**
 * Resolve whether a shadow routing recommendation could be executed *now*.
 *
 * This is deliberately separate from the pure collaboration planner:
 * routing shape alone is not execution readiness. A specialist is AUTO-ready
 * only when a concrete executor contract, enabled model policy and server-side
 * provider runtime all exist. This function never creates AgentTasks.
 */
export async function resolveKernDispatchReadiness(input: {
  organizationId: string;
  plan: KernCollaborationPlanShadow;
}): Promise<KernDispatchReadiness> {
  const { plan } = input;

  if (!plan.autoDispatchCandidate) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "REVIEW_REQUIRED",
      executor: "NONE",
      agentCode: null,
      taskClass: null,
      reason: "Routing mode/risk level requires review before any automatic dispatch.",
    };
  }

  if (plan.mode === "SOLO") {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: true,
      state: "INLINE_READY",
      executor: "INLINE",
      agentCode: null,
      taskClass: null,
      reason: "Low-risk SOLO work stays in the existing Kern conversational path.",
    };
  }

  if (plan.mode !== "SPECIALIST" || plan.experts.length !== 1) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "REVIEW_REQUIRED",
      executor: "NONE",
      agentCode: null,
      taskClass: null,
      reason: "Only a single low-risk specialist can enter the Phase 2 AUTO candidate path.",
    };
  }

  const agentCode = plan.experts[0];
  const contract = CHAT_SPECIALIST_EXECUTION[agentCode];
  if (!contract) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "NO_CHAT_EXECUTOR",
      executor: "NONE",
      agentCode,
      taskClass: null,
      reason: "The routed specialist has no generic Kern-chat executor contract.",
    };
  }

  const activeAgent = await prisma.agent.findFirst({
    where: {
      organizationId: input.organizationId,
      code: agentCode,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!activeAgent) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "AGENT_UNAVAILABLE",
      executor: contract.executor,
      agentCode,
      taskClass: contract.taskClass,
      reason:
        "The specialist contract exists, but the organization has no active matching Agent.",
    };
  }

  const resolved = await tryResolveGatewayPolicyForAgentCode({
    organizationId: input.organizationId,
    agentCode,
    taskClass: contract.taskClass,
  });

  if (!resolved) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "MODEL_POLICY_MISSING",
      executor: contract.executor,
      agentCode,
      taskClass: contract.taskClass,
      reason: "The specialist executor exists but no matching model policy binding is installed.",
    };
  }

  if (
    !hasEnabledPolicyCandidate({
      policy: resolved.policy,
      profiles: resolved.profiles,
    })
  ) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "MODEL_PROFILE_DISABLED",
      executor: contract.executor,
      agentCode,
      taskClass: contract.taskClass,
      reason: "The model policy exists but has no explicitly enabled candidate profile.",
    };
  }

  const candidateIds = new Set(
    resolved.policy.candidates.map((candidate) => candidate.profileId)
  );
  const runnable = resolved.profiles.some(
    (profile) =>
      candidateIds.has(profile.id) &&
      profile.enabled &&
      profile.health !== "UNAVAILABLE" &&
      (resolved.policy.cloudAllowed || profile.locality === "LOCAL") &&
      resolved.policy.requiredCapabilities.every((capability) =>
        profile.capabilities.includes(capability)
      ) &&
      isProviderRuntimeConfigured(profile.provider)
  );

  if (!runnable) {
    return {
      version: "kern-dispatch-readiness/v1",
      eligible: false,
      state: "PROVIDER_RUNTIME_MISSING",
      executor: contract.executor,
      agentCode,
      taskClass: contract.taskClass,
      reason:
        "An enabled candidate exists, but no candidate currently has an executable server-side provider runtime and required capabilities.",
    };
  }

  return {
    version: "kern-dispatch-readiness/v1",
    eligible: true,
    state: "EXECUTOR_READY",
    executor: contract.executor,
    agentCode,
    taskClass: contract.taskClass,
    reason: "A concrete specialist executor, model policy and provider runtime are ready.",
  };
}
