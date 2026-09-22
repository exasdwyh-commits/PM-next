import crypto from "node:crypto";
import {
  AgentTriggerType,
  AutopilotActionKind,
  AutopilotEventStatus,
  AutopilotStatus,
  DecisionRunPolicyAction,
  Prisma,
} from "@prisma/client";
import prisma from "@/shared/db";
import { createAuditEventInTx } from "@/shared/audit";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";
import { getOrCreateSystemPrincipalSession } from "@/modules/identity/system-principal";
import { isOrgAdmin } from "@/modules/identity/admin";
import {
  DecisionIntelligenceKernel,
  createDefaultDecisionSpecs,
  createDefaultRulesDecisionEngine,
  decideAndPersist,
} from "@/modules/decision-intelligence";
import { createAgentTask } from "@/modules/workforce/service";

const TERMINAL_RECEIPT_STATUSES = new Set<AutopilotEventStatus>([
  AutopilotEventStatus.TRIGGERED,
  AutopilotEventStatus.SUPPRESSED,
  AutopilotEventStatus.WAITING_HUMAN,
]);

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

function normalizeRefs(refs: string[]): string[] {
  return Array.from(
    new Set((refs ?? []).map((ref) => ref.trim()).filter(Boolean))
  ).sort();
}

function buildDefaultKernel(): DecisionIntelligenceKernel {
  const kernel = new DecisionIntelligenceKernel(createDefaultDecisionSpecs());
  kernel.registerEngine(createDefaultRulesDecisionEngine());
  return kernel;
}

async function requireAutopilotAdmin(session: SessionContext) {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError("Only organization admins can configure Autopilot");
  }
}

export async function bootstrapDefaultAutopilots(session: SessionContext) {
  await requireAutopilotAdmin(session);
  await getOrCreateSystemPrincipalSession(session.organizationId);

  const specs = [
    {
      key: "signal_wake_pm",
      name: "Signal → Hermes PM",
      description:
        "只使用信号现有真实字段判断：高价值且有明确价值依据时唤醒 Hermes PM，不伪造连续相关度分数。",
      decisionKey: "signal.should_wake_pm",
      decisionSpecVersion: "v2",
      actionKind: AutopilotActionKind.WAKE_PM,
    },
    {
      key: "product_version_red_team",
      name: "ProductVersion → Red Team",
      description:
        "发布新的不可变 ProductVersion 后自动唤醒 Red Team，挑战假设、规格/渠道适配与证据缺口。",
      decisionKey: "product_version.should_red_team",
      decisionSpecVersion: "v1",
      actionKind: AutopilotActionKind.WAKE_RED_TEAM,
    },
    {
      key: "evidence_recheck_pm",
      name: "Verified Evidence → Hermes PM",
      description:
        "REAL 证据被负责人正式核验后唤醒 Hermes PM，重新判断受影响的产品、分析和决策。",
      decisionKey: "evidence.should_wake_pm",
      decisionSpecVersion: "v1",
      actionKind: AutopilotActionKind.WAKE_PM,
    },
  ] as const;

  return prisma.$transaction(async (tx) => {
    let primaryId: string | null = null;
    const bootstrapped: Array<{
      id: string;
      key: string;
      decisionKey: string;
      decisionSpecVersion: string;
      actionKind: AutopilotActionKind;
    }> = [];

    for (const spec of specs) {
      const autopilot = await tx.autopilot.upsert({
        where: {
          organizationId_key: {
            organizationId: session.organizationId,
            key: spec.key,
          },
        },
        create: {
          organizationId: session.organizationId,
          key: spec.key,
          name: spec.name,
          description: spec.description,
          decisionKey: spec.decisionKey,
          decisionSpecVersion: spec.decisionSpecVersion,
          actionKind: spec.actionKind,
          cooldownSeconds: 300,
          failureThreshold: 3,
          createdById: session.userId,
        },
        update: {
          name: spec.name,
          description: spec.description,
          decisionKey: spec.decisionKey,
          decisionSpecVersion: spec.decisionSpecVersion,
          actionKind: spec.actionKind,
        },
      });
      if (spec.key === "signal_wake_pm") primaryId = autopilot.id;
      bootstrapped.push({
        id: autopilot.id,
        key: autopilot.key,
        decisionKey: autopilot.decisionKey,
        decisionSpecVersion: autopilot.decisionSpecVersion,
        actionKind: autopilot.actionKind,
      });
    }

    if (!primaryId) throw new Error("Signal Autopilot bootstrap invariant failed");

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AUTOPILOT_BOOTSTRAPPED",
      objectType: "Autopilot",
      objectId: primaryId,
      summary: "初始化默认业务 Autopilots",
      details: { autopilots: bootstrapped } as Prisma.InputJsonValue,
    });

    // Preserve the existing return contract: callers that only know the
    // original signal Autopilot still receive that row.
    return tx.autopilot.findUniqueOrThrow({ where: { id: primaryId } });
  });
}

export interface SubmitAutopilotEventInput {
  organizationId: string;
  autopilotKey: string;
  eventKey: string;
  eventType: string;
  sourceType?: string | null;
  sourceId?: string | null;
  state: unknown;
  criteria?: unknown;
  language?: string;
  contextRefs: string[];
  taskGoal: string;
  maxAttempts?: number;
}

export async function submitAutopilotEvent(
  input: SubmitAutopilotEventInput
): Promise<{ receipt: Awaited<ReturnType<typeof prisma.autopilotEventReceipt.create>>; deduplicated: boolean }> {
  const eventKey = input.eventKey?.trim();
  const eventType = input.eventType?.trim();
  const taskGoal = input.taskGoal?.trim();
  if (!eventKey || eventKey.length > 200) {
    throw new UnprocessableEntityError("eventKey is required and must be <= 200 chars");
  }
  if (!eventType || eventType.length > 100) {
    throw new UnprocessableEntityError("eventType is required and must be <= 100 chars");
  }
  if (!taskGoal) {
    throw new UnprocessableEntityError("taskGoal is required");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new UnprocessableEntityError("maxAttempts must be an integer between 1 and 20");
  }

  const autopilot = await prisma.autopilot.findUnique({
    where: {
      organizationId_key: {
        organizationId: input.organizationId,
        key: input.autopilotKey,
      },
    },
  });
  if (!autopilot) throw new NotFoundError("Autopilot not found");

  const contextRefs = normalizeRefs(input.contextRefs);
  const payload = canonicalize({
    state: input.state,
    criteria: input.criteria ?? null,
    language: input.language ?? null,
  });
  const payloadHash = hashCanonical({
    eventType,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    payload,
    contextRefs,
    taskGoal,
  });

  const terminalArchived = autopilot.status === AutopilotStatus.ARCHIVED;

  try {
    const receipt = await prisma.autopilotEventReceipt.create({
      data: {
        organizationId: input.organizationId,
        autopilotId: autopilot.id,
        eventKey,
        eventType,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        payloadHash,
        payloadJson: asJson(payload),
        contextRefs: asJson(contextRefs),
        taskGoal,
        maxAttempts,
        status: terminalArchived
          ? AutopilotEventStatus.SUPPRESSED
          : AutopilotEventStatus.PENDING,
        suppressionReason: terminalArchived ? "AUTOPILOT_ARCHIVED" : null,
        finishedAt: terminalArchived ? new Date() : null,
      },
    });
    return { receipt, deduplicated: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.autopilotEventReceipt.findUnique({
        where: {
          autopilotId_eventKey: {
            autopilotId: autopilot.id,
            eventKey,
          },
        },
      });
      if (!existing) throw error;
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictError(
          "同一 eventKey 已存在，但 payloadHash 不同；拒绝用同一幂等键覆盖另一事件"
        );
      }
      return { receipt: existing, deduplicated: true };
    }
    throw error;
  }
}

export interface ProcessAutopilotReceiptOptions {
  workerId: string;
  leaseMs?: number;
  now?: Date;
}

export interface ProcessAutopilotReceiptResult {
  receipt: Awaited<ReturnType<typeof prisma.autopilotEventReceipt.findUniqueOrThrow>>;
  disposition:
    | "TRIGGERED"
    | "SUPPRESSED"
    | "WAITING_HUMAN"
    | "DEFERRED"
    | "ALREADY_TERMINAL";
}

async function findAgentByCode(organizationId: string, code: string) {
  const agent = await prisma.agent.findUnique({
    where: {
      organizationId_code: {
        organizationId,
        code,
      },
    },
  });
  if (!agent) {
    throw new Error(code + " Agent is not bootstrapped");
  }
  return agent;
}

export async function processAutopilotReceipt(
  organizationId: string,
  receiptId: string,
  options: ProcessAutopilotReceiptOptions
): Promise<ProcessAutopilotReceiptResult> {
  const workerId = options.workerId?.trim();
  if (!workerId) throw new UnprocessableEntityError("workerId is required");
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 15 * 60_000) {
    throw new UnprocessableEntityError("leaseMs must be between 1000 and 900000");
  }
  const now = options.now ?? new Date();

  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AutopilotEventReceipt" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      receiptId,
      organizationId
    );

    const receipt = await tx.autopilotEventReceipt.findUnique({
      where: { id: receiptId },
      include: { autopilot: true },
    });
    if (!receipt || receipt.organizationId !== organizationId) {
      throw new NotFoundError("Autopilot receipt not found");
    }

    if (TERMINAL_RECEIPT_STATUSES.has(receipt.status)) {
      return { kind: "TERMINAL" as const, receipt };
    }

    if (receipt.autopilot.status === AutopilotStatus.ARCHIVED) {
      const updated = await tx.autopilotEventReceipt.update({
        where: { id: receipt.id },
        data: {
          status: AutopilotEventStatus.SUPPRESSED,
          suppressionReason: "AUTOPILOT_ARCHIVED",
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return { kind: "TERMINAL" as const, receipt: updated };
    }

    if (
      receipt.autopilot.status === AutopilotStatus.PAUSED ||
      (receipt.autopilot.pausedUntil &&
        receipt.autopilot.pausedUntil.getTime() > now.getTime())
    ) {
      // A live lease still owns the receipt. Pausing Autopilot prevents new
      // claims but must not steal work from an in-flight worker.
      if (
        receipt.status === AutopilotEventStatus.PROCESSING &&
        (!receipt.leaseExpiresAt ||
          receipt.leaseExpiresAt.getTime() <= now.getTime())
      ) {
        await tx.autopilotEventReceipt.update({
          where: { id: receipt.id },
          data: {
            status: AutopilotEventStatus.PENDING,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }
      return { kind: "DEFERRED" as const, receipt };
    }

    if (
      receipt.status === AutopilotEventStatus.PROCESSING &&
      receipt.leaseExpiresAt &&
      receipt.leaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new ConflictError(
        `Autopilot receipt is leased by ${receipt.leaseOwner ?? "another worker"}`
      );
    }

    if (receipt.attempt >= receipt.maxAttempts) {
      const failed = await tx.autopilotEventReceipt.update({
        where: { id: receipt.id },
        data: {
          status: AutopilotEventStatus.FAILED,
          errorReason: "MAX_ATTEMPTS_EXHAUSTED",
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return { kind: "TERMINAL" as const, receipt: failed };
    }

    const claimed = await tx.autopilotEventReceipt.update({
      where: { id: receipt.id },
      data: {
        status: AutopilotEventStatus.PROCESSING,
        attempt: { increment: 1 },
        startedAt: now,
        errorReason: null,
        suppressionReason: null,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
      },
      include: { autopilot: true },
    });
    return { kind: "CLAIMED" as const, receipt: claimed };
  });

  if (claim.kind === "DEFERRED") {
    return {
      receipt: await prisma.autopilotEventReceipt.findUniqueOrThrow({
        where: { id: receiptId },
      }),
      disposition: "DEFERRED",
    };
  }

  if (claim.kind === "TERMINAL") {
    const status = claim.receipt.status;
    return {
      receipt: await prisma.autopilotEventReceipt.findUniqueOrThrow({
        where: { id: receiptId },
      }),
      disposition:
        status === AutopilotEventStatus.TRIGGERED
          ? "TRIGGERED"
          : status === AutopilotEventStatus.WAITING_HUMAN
            ? "WAITING_HUMAN"
            : status === AutopilotEventStatus.SUPPRESSED
              ? "SUPPRESSED"
              : "ALREADY_TERMINAL",
    };
  }

  const claimed = claim.receipt;
  let runtimePrincipal: SessionContext | null = null;

  try {
    runtimePrincipal = await getOrCreateSystemPrincipalSession(organizationId);
    const principal = runtimePrincipal;
    const payload =
      claimed.payloadJson &&
      typeof claimed.payloadJson === "object" &&
      !Array.isArray(claimed.payloadJson)
        ? (claimed.payloadJson as Record<string, unknown>)
        : {};
    const refs = Array.isArray(claimed.contextRefs)
      ? claimed.contextRefs.filter(
          (value): value is string => typeof value === "string"
        )
      : [];

    const decision = await decideAndPersist(
      principal,
      buildDefaultKernel(),
      {
        decisionKey: claimed.autopilot.decisionKey,
        specVersion: claimed.autopilot.decisionSpecVersion,
        state: payload.state,
        criteria: payload.criteria,
        contextRefs: refs,
        language:
          typeof payload.language === "string" ? payload.language : undefined,
      },
      "RULES"
    );

    let agentTaskId: string | null = null;
    let status: AutopilotEventStatus;
    let suppressionReason: string | null = null;

    switch (decision.execution.policy.action) {
      case "AUTO": {
        if (decision.execution.engineResult.value !== true) {
          status = AutopilotEventStatus.SUPPRESSED;
          suppressionReason = "DECISION_FALSE";
          break;
        }

        const targetCode =
          claimed.autopilot.actionKind === AutopilotActionKind.WAKE_PM
            ? "hermes_pm"
            : claimed.autopilot.actionKind === AutopilotActionKind.WAKE_RED_TEAM
              ? "red_team"
              : null;
        if (!targetCode) {
          throw new Error(
            `Unsupported Autopilot actionKind: ${claimed.autopilot.actionKind}`
          );
        }

        const target = await findAgentByCode(organizationId, targetCode);
        const task = await createAgentTask(principal, {
          agentId: target.id,
          goal: claimed.taskGoal,
          triggerType: AgentTriggerType.EVENT,
          triggerRef:
            claimed.sourceId ??
            `${claimed.eventType}:${claimed.eventKey}`,
          triggerDecisionRunId: decision.decisionRun.id,
        });
        agentTaskId = task.id;
        status = AutopilotEventStatus.TRIGGERED;
        break;
      }

      case "ESCALATE_AGENT": {
        const hermes = await findAgentByCode(organizationId, "hermes_pm");
        const task = await createAgentTask(principal, {
          agentId: hermes.id,
          goal: "Review escalated Autopilot decision: " + claimed.taskGoal,
          triggerType: AgentTriggerType.EVENT,
          triggerRef:
            claimed.sourceId ??
            `${claimed.eventType}:${claimed.eventKey}`,
          triggerDecisionRunId: decision.decisionRun.id,
        });
        agentTaskId = task.id;
        status = AutopilotEventStatus.TRIGGERED;
        break;
      }

      case "ESCALATE_HUMAN":
        status = AutopilotEventStatus.WAITING_HUMAN;
        suppressionReason = "POLICY_ESCALATE_HUMAN";
        break;

      case "BLOCK":
        status = AutopilotEventStatus.SUPPRESSED;
        suppressionReason = "POLICY_BLOCK";
        break;
    }

    const finishedAt = new Date();
    const finalized = await prisma.$transaction(async (tx) => {
      const receipt = await tx.autopilotEventReceipt.update({
        where: { id: claimed.id },
        data: {
          status,
          decisionRunId: decision.decisionRun.id,
          agentTaskId,
          suppressionReason,
          errorReason: null,
          finishedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      await tx.autopilot.update({
        where: { id: claimed.autopilotId },
        data: {
          consecutiveFailures: 0,
          pausedUntil: null,
          lastError: null,
        },
      });

      await createAuditEventInTx(tx, {
        actorId: principal.userId,
        action: "AUTOPILOT_EVENT_PROCESSED",
        objectType: "AutopilotEventReceipt",
        objectId: receipt.id,
        summary:
          claimed.autopilot.key +
          " → " +
          status +
          (agentTaskId ? " / AgentTask created" : ""),
        details: {
          autopilotId: claimed.autopilotId,
          eventKey: claimed.eventKey,
          decisionRunId: decision.decisionRun.id,
          agentTaskId,
          status,
          suppressionReason,
        } as Prisma.InputJsonValue,
      });

      return receipt;
    });

    return {
      receipt: finalized,
      disposition:
        status === AutopilotEventStatus.TRIGGERED
          ? "TRIGGERED"
          : status === AutopilotEventStatus.WAITING_HUMAN
            ? "WAITING_HUMAN"
            : "SUPPRESSED",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT "id" FROM "Autopilot" WHERE "id" = $1 FOR UPDATE',
        claimed.autopilotId
      );
      const autopilot = await tx.autopilot.findUniqueOrThrow({
        where: { id: claimed.autopilotId },
      });
      const consecutiveFailures = autopilot.consecutiveFailures + 1;
      const shouldCooldown =
        consecutiveFailures >= autopilot.failureThreshold;
      const pausedUntil = shouldCooldown
        ? new Date(
            failedAt.getTime() + autopilot.cooldownSeconds * 1000
          )
        : autopilot.pausedUntil;

      await tx.autopilot.update({
        where: { id: autopilot.id },
        data: {
          consecutiveFailures,
          pausedUntil,
          lastError: message,
        },
      });

      await tx.autopilotEventReceipt.update({
        where: { id: claimed.id },
        data: {
          status: AutopilotEventStatus.FAILED,
          errorReason: message,
          finishedAt: failedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      if (runtimePrincipal) {
        await createAuditEventInTx(tx, {
          actorId: runtimePrincipal.userId,
          action: "AUTOPILOT_EVENT_FAILED",
          objectType: "AutopilotEventReceipt",
          objectId: claimed.id,
          summary: "Autopilot event processing failed",
          details: {
            autopilotId: claimed.autopilotId,
            eventKey: claimed.eventKey,
            attempt: claimed.attempt,
            consecutiveFailures,
            pausedUntil: pausedUntil?.toISOString() ?? null,
            error: message,
          } as Prisma.InputJsonValue,
        });
      }
    });

    throw error;
  }
}

export async function setAutopilotPaused(
  session: SessionContext,
  autopilotId: string,
  paused: boolean,
  reason?: string
) {
  await requireAutopilotAdmin(session);

  const autopilot = await prisma.autopilot.findUnique({
    where: { id: autopilotId },
  });
  if (!autopilot || autopilot.organizationId !== session.organizationId) {
    throw new NotFoundError("Autopilot not found");
  }
  if (autopilot.status === AutopilotStatus.ARCHIVED) {
    throw new ConflictError("Archived Autopilot cannot be resumed");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.autopilot.update({
      where: { id: autopilot.id },
      data: paused
        ? { status: AutopilotStatus.PAUSED }
        : {
            status: AutopilotStatus.ACTIVE,
            pausedUntil: null,
            consecutiveFailures: 0,
          },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: paused ? "AUTOPILOT_PAUSED" : "AUTOPILOT_RESUMED",
      objectType: "Autopilot",
      objectId: updated.id,
      summary: paused ? "人工暂停 Autopilot" : "人工恢复 Autopilot",
      details: {
        reason: reason?.trim() || null,
        previousStatus: autopilot.status,
        newStatus: updated.status,
      } as Prisma.InputJsonValue,
    });

    return updated;
  });
}
