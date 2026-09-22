import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { ConflictError, UnprocessableEntityError } from "@/shared/errors";

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

export interface EnqueueBusinessEventInput {
  organizationId: string;
  eventKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  contextRefs?: string[];
  createdById?: string | null;
  maxAttempts?: number;
}

/**
 * Must be called inside the same DB transaction as the business mutation.
 *
 * This is the core transactional-outbox invariant:
 * the domain fact and its event either commit together or neither commits.
 */
export async function enqueueBusinessEventInTx(
  tx: Prisma.TransactionClient,
  input: EnqueueBusinessEventInput
) {
  const eventKey = input.eventKey?.trim();
  const eventType = input.eventType?.trim();
  const aggregateType = input.aggregateType?.trim();
  const aggregateId = input.aggregateId?.trim();
  if (!eventKey || !eventType || !aggregateType || !aggregateId) {
    throw new UnprocessableEntityError(
      "eventKey, eventType, aggregateType and aggregateId are required"
    );
  }

  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new UnprocessableEntityError(
      "BusinessEvent maxAttempts must be an integer between 1 and 20"
    );
  }

  const contextRefs = normalizeRefs(input.contextRefs ?? []);
  const payload = canonicalize(input.payload);
  const payloadHash = hashCanonical({
    eventType,
    aggregateType,
    aggregateId,
    payload,
    contextRefs,
  });

  const event = await tx.businessEvent.upsert({
    where: {
      organizationId_eventKey: {
        organizationId: input.organizationId,
        eventKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      eventKey,
      eventType,
      aggregateType,
      aggregateId,
      payloadJson: asJson(payload),
      payloadHash,
      contextRefs: asJson(contextRefs),
      maxAttempts,
      createdById: input.createdById ?? null,
    },
    update: {},
  });

  if (
    event.eventType !== eventType ||
    event.aggregateType !== aggregateType ||
    event.aggregateId !== aggregateId ||
    event.payloadHash !== payloadHash
  ) {
    throw new ConflictError(
      "BusinessEvent idempotency key already exists with a different payload"
    );
  }

  return event;
}
