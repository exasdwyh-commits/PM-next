import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { InMemoryModelHealthStore } from "./health";
import { ModelGateway, ModelGatewayExecutionError } from "./gateway";
import { ModelRegistry } from "./registry";
import { createOpenAICompatibleProviderPlugin } from "./provider-runtime";
import type {
  ModelGatewayRequest,
  ModelGatewayResult,
  ModelPolicy,
  ModelProfile,
} from "./types";

const sharedHealthStore = new InMemoryModelHealthStore();

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function hasEnabledPolicyCandidate(params: {
  policy: ModelPolicy;
  profiles: ModelProfile[];
}): boolean {
  const enabled = new Set(
    params.profiles.filter((profile) => profile.enabled).map((profile) => profile.id)
  );
  return params.policy.candidates.some((candidate) => enabled.has(candidate.profileId));
}

export interface PersistedGatewayExecutionInput {
  organizationId: string;
  agentRunId?: string | null;
  policy: ModelPolicy;
  profiles: ModelProfile[];
  request: ModelGatewayRequest;
  requestMeta?: Record<string, string | number | boolean | null>;
}

export interface PersistedGatewayExecutionResult {
  modelRunId: string;
  result: ModelGatewayResult;
}

/**
 * Execute one policy through ModelGateway and persist the exact routing outcome.
 *
 * Request messages are deliberately not stored in ModelRun. The surrounding
 * AgentRun owns business context; ModelRun stores model provenance only.
 */
export async function executePersistedModelGateway(
  input: PersistedGatewayExecutionInput
): Promise<PersistedGatewayExecutionResult> {
  const startedAt = new Date();
  const modelRun = await prisma.modelRun.create({
    data: {
      organizationId: input.organizationId,
      agentRunId: input.agentRunId || null,
      taskClass: input.request.taskClass,
      policyKey: input.policy.id,
      policyVersion: input.policy.version,
      status: "RUNNING",
      requestMeta: input.requestMeta
        ? jsonValue(input.requestMeta)
        : Prisma.JsonNull,
      startedAt,
    },
  });

  const registry = new ModelRegistry();
  for (const profile of input.profiles) registry.registerProfile(profile);

  const providers = new Set(input.profiles.map((profile) => profile.provider));
  for (const provider of providers) {
    registry.registerProvider(createOpenAICompatibleProviderPlugin(provider));
  }

  const gateway = new ModelGateway(registry, sharedHealthStore);

  try {
    const result = await gateway.execute(input.policy, input.request);
    const finishedAt = new Date();

    await prisma.modelRun.update({
      where: { id: modelRun.id },
      data: {
        status: "SUCCEEDED",
        profileKey: result.profileId,
        provider: result.provider,
        modelId: result.resolvedModelId,
        attempts: jsonValue(result.attempts),
        routingSkips: jsonValue(result.routingSkips),
        usageJson: result.usage
          ? jsonValue(result.usage)
          : Prisma.JsonNull,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    return { modelRunId: modelRun.id, result };
  } catch (error: unknown) {
    const finishedAt = new Date();
    const attempts =
      error instanceof ModelGatewayExecutionError ? error.attempts : [];
    const routingSkips =
      error instanceof ModelGatewayExecutionError ? error.routingSkips : [];
    const lastAttempt = attempts.at(-1);

    await prisma.modelRun.update({
      where: { id: modelRun.id },
      data: {
        status: "FAILED",
        profileKey: lastAttempt?.profileId || null,
        provider: lastAttempt?.provider || null,
        modelId: lastAttempt?.modelId || null,
        attempts: jsonValue(attempts),
        routingSkips: jsonValue(routingSkips),
        errorReason: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    throw error;
  }
}
