import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { CHARGED_MODEL_ATTEMPT_WHERE, chargeModelCallInTx } from "@/modules/usage";
import { InMemoryModelHealthStore } from "./health";
import { ModelGateway, ModelGatewayExecutionError } from "./gateway";
import { ModelRegistry } from "./registry";
import { createOpenAICompatibleProviderPlugin, type OpenAICompatibleProviderRuntime } from "./provider-runtime";
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
  /** Trusted server configuration only; never read from client payloads or persisted. */
  providerRuntime?: OpenAICompatibleProviderRuntime;
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
  const registry = new ModelRegistry();
  for (const profile of input.profiles) registry.registerProfile(profile);
  const logicalCallId = randomUUID();
  const controller = new AbortController();
  const callerSignal = input.request.signal;
  const abort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", abort, { once: true });
  if (callerSignal?.aborted) abort();
  const request = { ...input.request, signal: controller.signal };
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let currentRun: { id: string; startedAt: Date } | null = null;

  // Rows represent admissions. Transport provenance distinguishes a closed,
  // unsent reservation from an actual attempt; retries share one logical ID.
  const admit = async (profile: ModelProfile) => {
    request.signal.throwIfAborted();
    const admitted = await prisma.$transaction(
      (tx) => chargeModelCallInTx(tx, input.organizationId, async () => {
        request.signal.throwIfAborted();
        const run = input.agentRunId ? await tx.agentRun.findUnique({
          where: { id: input.agentRunId }, select: {
            organizationId: true, agentTaskId: true, startedAt: true,
            agentTask: { select: { parentTaskId: true, startedAt: true, parentTask: { select: { startedAt: true } } } },
          },
        }) : null;
        if (input.agentRunId && (!run || run.organizationId !== input.organizationId)) {
          throw new Error("Model execution run does not belong to this organization");
        }
        const taskId = run?.agentTask?.parentTaskId ?? run?.agentTaskId;
        const scopeKey = taskId ? `task:${taskId}` : `run:${input.agentRunId ?? logicalCallId}`;
        const first = await tx.modelRun.findFirst({
          where: { organizationId: input.organizationId, budgetScopeKey: scopeKey },
          orderBy: { createdAt: "asc" }, select: { budgetMaxAttempts: true, budgetDeadlineAt: true },
        });
        const maxAttempts = first?.budgetMaxAttempts ?? positiveLimit("KERN_MODEL_BUDGET_ATTEMPTS", taskId ? 64 : 16);
        const startedAt = run?.agentTask?.parentTask?.startedAt ?? run?.agentTask?.startedAt ?? run?.startedAt;
        const deadline = first?.budgetDeadlineAt ?? new Date((startedAt?.getTime() ?? Date.now()) + positiveLimit("KERN_MODEL_BUDGET_MS", taskId ? 900_000 : 120_000));
        const used = await tx.modelRun.count({ where: {
          organizationId: input.organizationId, budgetScopeKey: scopeKey, ...CHARGED_MODEL_ATTEMPT_WHERE,
        } });
        if (used >= maxAttempts) throw new ModelExecutionBudgetError(`任务模型尝试已达预算 ${maxAttempts} 次`);
        if (deadline.getTime() <= Date.now()) throw new ModelExecutionBudgetError("任务模型执行耗时已达预算（timeout）");
        const row = await tx.modelRun.create({ data: {
          organizationId: input.organizationId,
          agentRunId: input.agentRunId || null,
          logicalCallId, transportKnown: true,
          budgetScopeKey: scopeKey, budgetMaxAttempts: maxAttempts, budgetDeadlineAt: deadline,
          taskClass: input.request.taskClass,
          policyKey: input.policy.id, policyVersion: input.policy.version,
          profileKey: profile.id, provider: profile.provider, modelId: profile.modelId,
          status: "RUNNING",
          requestMeta: input.requestMeta ? jsonValue(input.requestMeta) : Prisma.JsonNull,
          startedAt: new Date(),
        } });
        return { row, deadline };
      }), { timeout: 10_000 },
    );
    currentRun = admitted.row;
    clearTimeout(deadlineTimer);
    const remaining = admitted.deadline.getTime() - Date.now();
    deadlineTimer = setTimeout(() => controller.abort(new ModelExecutionBudgetError("任务模型执行耗时已达预算（timeout）")), Math.max(0, remaining));
    if (remaining <= 0) controller.abort(new ModelExecutionBudgetError("任务模型执行耗时已达预算（timeout）"));
  };
  const providers = new Set(input.profiles.map((profile) => profile.provider));
  for (const provider of providers) {
    const plugin = createOpenAICompatibleProviderPlugin(provider, {
      runtime: input.providerRuntime?.provider === provider ? input.providerRuntime : undefined,
      beforeTransport: async () => {
        request.signal.throwIfAborted();
        if (!currentRun) throw new Error("Provider attempt was not admitted");
        // This records the handoff to fetch, not proof that the remote server accepted it.
        await prisma.modelRun.update({ where: { id: currentRun.id }, data: { transportStartedAt: new Date() } });
        if (request.signal.aborted) {
          await prisma.modelRun.update({ where: { id: currentRun.id }, data: { transportStartedAt: null } });
          request.signal.throwIfAborted();
        }
      },
    });
    registry.registerProvider({
      ...plugin,
      execute: async (profile, request) => {
        const row = currentRun;
        if (!row) throw new Error("Provider attempt was not admitted");
        let result;
        try {
          result = await plugin.execute(profile, request);
        } catch (error) {
          const finishedAt = new Date();
          await prisma.modelRun.update({ where: { id: row.id }, data: {
            status: "FAILED", finishedAt,
            durationMs: finishedAt.getTime() - row.startedAt.getTime(),
            errorReason: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          } });
          throw error;
        }
        const finishedAt = new Date();
        await prisma.modelRun.update({ where: { id: row.id }, data: {
          status: "SUCCEEDED", modelId: result.modelId ?? profile.modelId,
          usageJson: result.usage ? jsonValue(result.usage) : Prisma.JsonNull,
          finishedAt, durationMs: finishedAt.getTime() - row.startedAt.getTime(),
        } });
        return result;
      },
    });
  }
  const gateway = new ModelGateway(registry, sharedHealthStore, Date.now, undefined, admit);
  try {
    const result = await gateway.execute(input.policy, request);
    const row = currentRun as { id: string; startedAt: Date } | null;
    if (!row) throw new Error("No provider attempt was executed");
    await prisma.modelRun.update({ where: { id: row.id }, data: {
      attempts: jsonValue(result.attempts), routingSkips: jsonValue(result.routingSkips),
    } });
    return { modelRunId: row.id, result };
  } catch (error) {
    const row = currentRun as { id: string; startedAt: Date } | null;
    if (row) {
      // Admission can succeed before the final cancellation check; close its ledger row
      // without classifying cancellation as provider failure or starting fallback.
      const finishedAt = new Date();
      await prisma.modelRun.updateMany({ where: { id: row.id, status: "RUNNING" }, data: {
        status: "FAILED", finishedAt, durationMs: finishedAt.getTime() - row.startedAt.getTime(),
        errorReason: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      } });
    }
    if (row && error instanceof ModelGatewayExecutionError) {
      await prisma.modelRun.update({ where: { id: row.id }, data: {
        attempts: jsonValue(error.attempts), routingSkips: jsonValue(error.routingSkips),
      } });
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    callerSignal?.removeEventListener("abort", abort);
  }
}

export class ModelExecutionBudgetError extends Error {
  constructor(message: string) { super(message); this.name = "ModelExecutionBudgetError"; }
}

function positiveLimit(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : fallback;
}

