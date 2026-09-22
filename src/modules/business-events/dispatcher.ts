import {
  BusinessEventStatus,
  Prisma,
} from "@prisma/client";
import prisma from "@/shared/db";
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import {
  processAutopilotReceipt,
  submitAutopilotEvent,
} from "@/modules/autopilot/service";

export const BUSINESS_EVENT_TYPES = {
  SIGNAL_CAPTURED: "SIGNAL_CAPTURED",
  PRODUCT_VERSION_PUBLISHED: "PRODUCT_VERSION_PUBLISHED",
  EVIDENCE_VERIFIED: "EVIDENCE_VERIFIED",
  AGENT_CHILD_TERMINAL: "AGENT_CHILD_TERMINAL",
} as const;

type BusinessEventType =
  (typeof BUSINESS_EVENT_TYPES)[keyof typeof BUSINESS_EVENT_TYPES];

type DispatchPlan = {
  autopilotKey: string;
  state: Record<string, unknown>;
  criteria?: Record<string, unknown>;
  taskGoal: string;
};

function objectPayload(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function refs(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function planForEvent(event: {
  eventType: string;
  payloadJson: Prisma.JsonValue;
}): DispatchPlan {
  const payload = objectPayload(event.payloadJson);

  switch (event.eventType as BusinessEventType) {
    case BUSINESS_EVENT_TYPES.SIGNAL_CAPTURED:
      return {
        autopilotKey: "signal_wake_pm",
        state: {
          valueTier: payload.valueTier ?? null,
          hasValueReason:
            typeof payload.valueReason === "string" &&
            payload.valueReason.trim().length > 0,
          verifyStatus: payload.verifyStatus ?? null,
          nature: payload.nature ?? null,
          category: payload.category ?? null,
          channel: payload.channel ?? null,
          productRef: payload.productRef ?? null,
        },
        criteria: {
          sourceKey: payload.sourceKey ?? null,
          collectedBy: payload.collectedBy ?? null,
        },
        taskGoal:
          "Review high-value market signal: " +
          String(payload.title ?? "Untitled signal") +
          ". Treat the signal as UNVERIFIED until evidence is formally verified; decide whether to validate, ignore, or convert it into a product opportunity.",
      };

    case BUSINESS_EVENT_TYPES.PRODUCT_VERSION_PUBLISHED:
      return {
        autopilotKey: "product_version_red_team",
        state: {
          versionTag: payload.versionTag ?? null,
          isImmutable: payload.isImmutable === true,
          isConfirmed: payload.isConfirmed === true,
          hasUnknowns: payload.hasUnknowns === true,
        },
        taskGoal:
          "Red-team product version " +
          String(payload.versionTag ?? "") +
          ": challenge changed assumptions, channel/spec fit, evidence gaps and failure paths before the version drives downstream execution.",
      };

    case BUSINESS_EVENT_TYPES.EVIDENCE_VERIFIED:
      return {
        autopilotKey: "evidence_recheck_pm",
        state: {
          verifyStatus: payload.verifyStatus ?? null,
          nature: payload.nature ?? null,
          validationStatus: payload.validationStatus ?? null,
        },
        taskGoal:
          "Re-evaluate the affected product/project after newly verified evidence. Identify which assumptions, analyses, decisions or product specifications may now need review.",
      };

    case BUSINESS_EVENT_TYPES.AGENT_CHILD_TERMINAL:
      return {
        autopilotKey: "child_task_return",
        state: {
          parentAgentCode: payload.parentAgentCode ?? null,
          parentTaskId: payload.parentTaskId ?? null,
          childTaskId: payload.childTaskId ?? null,
          childAgentCode: payload.childAgentCode ?? null,
          childOutcome: payload.childOutcome ?? null,
          reason: payload.reason ?? null,
        },
        taskGoal:
          "Review returned child-agent result for parent task " +
          String(payload.parentTaskId ?? "") +
          ". Child " +
          String(payload.childAgentCode ?? "agent") +
          " finished with " +
          String(payload.childOutcome ?? "UNKNOWN") +
          ". Reconcile the result with the parent objective, decide whether to continue, redelegate, escalate, or close the parent work.",
      };

    default:
      throw new UnprocessableEntityError(
        "No Autopilot mapping for BusinessEvent type " + event.eventType
      );
  }
}

export interface DispatchBusinessEventOptions {
  workerId: string;
  leaseMs?: number;
  processAutopilot?: boolean;
  now?: Date;
}

export interface DispatchBusinessEventResult {
  eventId: string;
  disposition: "DISPATCHED" | "DEFERRED" | "ALREADY_DISPATCHED";
  autopilotReceiptId: string | null;
  autopilotDisposition?: string | null;
  autopilotError?: string | null;
}

export async function dispatchBusinessEvent(
  organizationId: string,
  eventId: string,
  options: DispatchBusinessEventOptions
): Promise<DispatchBusinessEventResult> {
  const workerId = options.workerId?.trim();
  if (!workerId) throw new UnprocessableEntityError("workerId is required");
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 15 * 60_000) {
    throw new UnprocessableEntityError("leaseMs must be between 1000 and 900000");
  }
  const now = options.now ?? new Date();

  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "BusinessEvent" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      eventId,
      organizationId
    );

    const event = await tx.businessEvent.findUnique({ where: { id: eventId } });
    if (!event || event.organizationId !== organizationId) {
      throw new NotFoundError("Business event not found");
    }

    if (event.status === BusinessEventStatus.DISPATCHED) {
      return { kind: "DISPATCHED" as const, event };
    }

    if (
      event.status === BusinessEventStatus.PROCESSING &&
      event.leaseExpiresAt &&
      event.leaseExpiresAt.getTime() > now.getTime()
    ) {
      throw new ConflictError(
        "Business event is leased by " + (event.leaseOwner ?? "another worker")
      );
    }

    let plan: DispatchPlan;
    try {
      plan = planForEvent(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await tx.businessEvent.update({
        where: { id: event.id },
        data: {
          status: BusinessEventStatus.FAILED,
          lastError: message,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return { kind: "FAILED_MAPPING" as const, event: failed, error };
    }

    const configured = await tx.autopilot.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key: plan.autopilotKey,
        },
      },
      select: { id: true },
    });
    if (!configured) {
      const deferred = await tx.businessEvent.update({
        where: { id: event.id },
        data: {
          status: BusinessEventStatus.PENDING,
          lastError: "AUTOPILOT_NOT_CONFIGURED:" + plan.autopilotKey,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return { kind: "DEFERRED" as const, event: deferred, plan };
    }

    if (event.attempt >= event.maxAttempts) {
      const failed = await tx.businessEvent.update({
        where: { id: event.id },
        data: {
          status: BusinessEventStatus.FAILED,
          lastError: "MAX_ATTEMPTS_EXHAUSTED",
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return { kind: "EXHAUSTED" as const, event: failed };
    }

    const claimed = await tx.businessEvent.update({
      where: { id: event.id },
      data: {
        status: BusinessEventStatus.PROCESSING,
        attempt: { increment: 1 },
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        lastError: null,
      },
    });

    return { kind: "CLAIMED" as const, event: claimed, plan };
  });

  if (claim.kind === "DISPATCHED") {
    return {
      eventId,
      disposition: "ALREADY_DISPATCHED",
      autopilotReceiptId: claim.event.autopilotReceiptId,
    };
  }

  if (claim.kind === "DEFERRED") {
    return {
      eventId,
      disposition: "DEFERRED",
      autopilotReceiptId: null,
    };
  }

  if (claim.kind === "FAILED_MAPPING") {
    throw claim.error;
  }

  if (claim.kind === "EXHAUSTED") {
    throw new ConflictError("Business event max attempts exhausted");
  }

  const contextRefs = refs(claim.event.contextRefs);

  try {
    const submitted = await submitAutopilotEvent({
      organizationId,
      autopilotKey: claim.plan.autopilotKey,
      eventKey: "business-event:" + claim.event.id,
      eventType: claim.event.eventType,
      sourceType: claim.event.aggregateType,
      sourceId: claim.event.aggregateId,
      state: claim.plan.state,
      criteria: claim.plan.criteria,
      contextRefs,
      taskGoal: claim.plan.taskGoal,
      maxAttempts: 3,
    });

    const dispatchedAt = new Date();
    await prisma.businessEvent.update({
      where: { id: claim.event.id },
      data: {
        status: BusinessEventStatus.DISPATCHED,
        autopilotReceiptId: submitted.receipt.id,
        dispatchedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });

    if (options.processAutopilot === false) {
      return {
        eventId,
        disposition: "DISPATCHED",
        autopilotReceiptId: submitted.receipt.id,
        autopilotDisposition: null,
      };
    }

    try {
      const processed = await processAutopilotReceipt(
        organizationId,
        submitted.receipt.id,
        { workerId: workerId + ":autopilot" }
      );
      return {
        eventId,
        disposition: "DISPATCHED",
        autopilotReceiptId: submitted.receipt.id,
        autopilotDisposition: processed.disposition,
      };
    } catch (error) {
      // Delivery succeeded once the durable Autopilot receipt exists.
      // Autopilot owns its own retries/cooldown after this point.
      return {
        eventId,
        disposition: "DISPATCHED",
        autopilotReceiptId: submitted.receipt.id,
        autopilotDisposition: null,
        autopilotError: error instanceof Error ? error.message : String(error),
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.businessEvent.update({
      where: { id: claim.event.id },
      data: {
        status: BusinessEventStatus.FAILED,
        lastError: message,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    throw error;
  }
}

export async function dispatchPendingBusinessEvents(
  organizationId: string,
  options: {
    workerId: string;
    limit?: number;
    processAutopilot?: boolean;
  }
) {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const candidates = await prisma.businessEvent.findMany({
    where: {
      organizationId,
      status: { in: [BusinessEventStatus.PENDING, BusinessEventStatus.FAILED] },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: new Date() } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results: Array<
    | DispatchBusinessEventResult
    | { eventId: string; disposition: "ERROR"; error: string }
  > = [];
  for (const candidate of candidates) {
    try {
      results.push(
        await dispatchBusinessEvent(organizationId, candidate.id, {
          workerId: options.workerId,
          processAutopilot: options.processAutopilot,
        })
      );
    } catch (error) {
      results.push({
        eventId: candidate.id,
        disposition: "ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
