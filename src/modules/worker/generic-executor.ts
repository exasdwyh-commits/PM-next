import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import {
  executePersistedModelGateway,
  hasEnabledPolicyCandidate,
} from "@/modules/model-gateway";
import { isProviderRuntimeConfigured } from "@/modules/model-gateway/provider-runtime";
import type { ExecutorOutcome, ExecutorStrategy } from "./executor";
import {
  buildGenericAgentMessages,
  type GenericAgentContract,
} from "./generic-agent-contracts";

function blocked(summary: string, reason: string, missing: string): ExecutorOutcome {
  return {
    kind: "BLOCKED",
    summary,
    reason,
    result: { kind: "HONEST_BLOCKED", missingInputs: [missing] },
    dataGaps: [],
  };
}

/**
 * Generic Agent Runtime:
 *
 *   AgentTask → contract identity → model policy → provider readiness
 *   → Model Gateway (persisted ModelRun provenance) → structured advisory result
 *
 * Any missing precondition ends in an honest BLOCKED with a precise missing
 * input; nothing is fabricated when no runnable model exists.
 */
export function createGenericAgentStrategy(
  contract: GenericAgentContract
): ExecutorStrategy {
  const name = contract.displayName;
  const code = contract.agentCode;
  const cls = contract.taskClass;

  return async (context) => {
    const resolved = await tryResolveGatewayPolicyForAgentCode({
      organizationId: context.session.organizationId,
      agentCode: code,
      taskClass: cls,
    });

    if (!resolved) {
      return blocked(
        `${name} 未执行：组织尚未为 ${code} 配置 ${cls} 模型策略。`,
        `${name} ${cls} policy is not configured.`,
        `${code} ${cls} policy binding`
      );
    }

    if (!hasEnabledPolicyCandidate({ policy: resolved.policy, profiles: resolved.profiles })) {
      return blocked(
        `${name} 未执行：${cls} 策略存在，但当前没有显式启用的候选模型。`,
        `${name} ${cls} policy has no enabled candidate.`,
        `enabled ${cls} model profile`
      );
    }

    const candidateIds = new Set(
      resolved.policy.candidates.map((candidate) => candidate.profileId)
    );
    const runnable = resolved.profiles.filter(
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

    if (runnable.length === 0) {
      return blocked(
        `${name} 未执行：候选模型虽已启用，但服务端 provider runtime 尚未配置或不满足 ${cls} 能力约束。`,
        `${name} provider runtime is not executable.`,
        `configured provider runtime for an enabled ${cls} profile`
      );
    }

    const source = `kern.generic-agent.${code}`;
    const executed = await executePersistedModelGateway({
      organizationId: context.session.organizationId,
      agentRunId: context.task.runId,
      policy: resolved.policy,
      profiles: resolved.profiles,
      request: {
        taskClass: cls,
        requiredCapabilities: contract.requiredCapabilities,
        messages: buildGenericAgentMessages(contract, context.task.goal),
        metadata: {
          source,
          agentTaskId: context.task.id,
          projectId: context.task.projectId,
          advisoryOnly: true,
          contractVersion: contract.version,
        },
      },
      requestMeta: { source, agentTaskId: context.task.id, advisoryOnly: true },
    });

    const output = executed.result.text.trim();
    if (!output) {
      // An empty model answer is a failure, not a success.
      throw new Error(`${name} model returned empty output`);
    }
    return {
      kind: "SUCCEEDED",
      summary: output.slice(0, 4000),
      result: {
        kind: contract.resultKind,
        output,
        advisoryOnly: true,
        contractVersion: contract.version,
        outputSections: contract.outputSections,
        modelRunId: executed.modelRunId,
        profileId: executed.result.profileId,
        provider: executed.result.provider,
        modelId: executed.result.resolvedModelId,
        policyId: executed.result.policyId,
        policyVersion: executed.result.policyVersion,
      },
    };
  };
}
