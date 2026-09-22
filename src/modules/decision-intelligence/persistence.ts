import crypto from "node:crypto";
import {
  DecisionRun as PrismaDecisionRun,
  DecisionRunEngineKind,
  DecisionRunPolicyAction,
  DecisionRunRiskClass,
  Prisma,
} from "@prisma/client";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import type { SessionContext } from "@/modules/identity/session";
import type {
  DecisionEngine,
  DecisionExecutionResult,
  DecisionRequest,
} from "./types";
import { DecisionIntelligenceKernel } from "./kernel";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, canonicalize(val)])
    );
  }
  return value;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(canonicalize(value))) as Prisma.InputJsonValue;
}

function hashCanonical(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function normalizeContextRefs(refs: string[]): string[] {
  return Array.from(
    new Set((refs ?? []).map((ref) => ref.trim()).filter(Boolean))
  ).sort();
}

function engineKind(
  value: DecisionExecutionResult["engineResult"]["engine"]
): DecisionRunEngineKind {
  return value === "RULES"
    ? DecisionRunEngineKind.RULES
    : DecisionRunEngineKind.MODEL;
}

function riskClass(
  value: DecisionExecutionResult["spec"]["riskClass"]
): DecisionRunRiskClass {
  return DecisionRunRiskClass[value];
}

function policyAction(
  value: DecisionExecutionResult["policy"]["action"]
): DecisionRunPolicyAction {
  return DecisionRunPolicyAction[value];
}

export interface PersistedDecisionExecution {
  execution: DecisionExecutionResult;
  decisionRun: PrismaDecisionRun;
}

/**
 * Execute a typed DecisionSpec and persist the exact provenance used for the
 * decision. Persistence does not perform the policy action. AUTO is evidence
 * that the action is eligible for automation, not proof the action happened.
 */
export async function decideAndPersist(
  session: SessionContext,
  kernel: DecisionIntelligenceKernel,
  request: DecisionRequest,
  preferredEngine?: DecisionEngine["kind"]
): Promise<PersistedDecisionExecution> {
  const contextRefs = normalizeContextRefs(request.contextRefs);
  const normalizedRequest: DecisionRequest = {
    ...request,
    contextRefs,
  };
  const execution = await kernel.decide(normalizedRequest, preferredEngine);

  const inputSnapshot = canonicalize(request.state);
  const criteriaSnapshot =
    request.criteria === undefined ? undefined : canonicalize(request.criteria);

  const inputHash = hashCanonical({
    decisionKey: execution.spec.key,
    specVersion: execution.spec.version,
    state: inputSnapshot,
    criteria: criteriaSnapshot ?? null,
    contextRefs,
    language: request.language ?? null,
  });
  const criteriaHash =
    criteriaSnapshot === undefined ? null : hashCanonical(criteriaSnapshot);

  const decisionRun = await prisma.$transaction(async (tx) => {
    const row = await tx.decisionRun.create({
      data: {
        organizationId: session.organizationId,
        decisionKey: execution.spec.key,
        specVersion: execution.spec.version,
        outputType: execution.spec.outputType,
        riskClass: riskClass(execution.spec.riskClass),
        engine: engineKind(execution.engineResult.engine),
        engineVersion: execution.engineResult.engineVersion,
        inputSnapshot: asJson(inputSnapshot),
        inputHash,
        criteriaSnapshot:
          criteriaSnapshot === undefined ? undefined : asJson(criteriaSnapshot),
        criteriaHash,
        contextRefs: asJson(contextRefs),
        language: request.language ?? null,
        resultJson: asJson({ value: execution.engineResult.value }),
        confidence: execution.engineResult.confidence,
        distribution: execution.engineResult.distribution
          ? asJson(execution.engineResult.distribution)
          : undefined,
        reasonCodes: asJson(execution.engineResult.reasonCodes),
        latencyMs: Math.max(0, Math.round(execution.engineResult.latencyMs)),
        calibrated: execution.engineResult.calibrated,
        calibrationProfile: execution.engineResult.calibrationProfile,
        benchmarkProfile: execution.engineResult.benchmarkProfile,
        policyAction: policyAction(execution.policy.action),
        policyReasons: asJson(execution.policy.reasons),
        createdById: session.userId,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "DECISION_RUN_RECORDED",
      objectType: "DecisionRun",
      objectId: row.id,
      summary:
        execution.spec.key +
        "@" +
        execution.spec.version +
        " → " +
        execution.policy.action,
      details: {
        decisionKey: execution.spec.key,
        specVersion: execution.spec.version,
        engine: execution.engineResult.engine,
        engineVersion: execution.engineResult.engineVersion,
        policyAction: execution.policy.action,
        inputHash,
        contextRefs,
      } as Prisma.InputJsonValue,
    });

    return row;
  });

  return { execution, decisionRun };
}
