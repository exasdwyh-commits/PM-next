import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import type { SessionContext } from "@/modules/identity/session";

/**
 * Kern Mission Event Log
 * ======================
 *
 * Append-only, per-mission ordered stream that powers the 「过程」 timeline and
 * SSE. `seq` is strictly monotonic per mission (1, 2, 3 …): appends take a
 * transaction-scoped advisory lock keyed by the mission id, so concurrent
 * writers (worker executor + supervisor advance + user controls) never
 * collide, and `@@unique([missionTaskId, seq])` is the last line of defence.
 *
 * The legacy `snapshot.log` is still written for compatibility (PR ①); the UI
 * switches to this stream in PR ②.
 */

export const MISSION_EVENT_TYPES = [
  "mission.launched",
  "mission.paused",
  "mission.resumed",
  "mission.cancelled",
  "mission.finished",
  "plan.edited",
  "node.dispatched",
  "node.started",
  "node.delta",
  "node.tool",
  "node.cite",
  "node.finished",
  "node.skipped",
  "node.rerun",
  "qa.revise",
  "user.input",
  "user.input.applied",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export interface MissionEventInput {
  type: MissionEventType;
  nodeKey?: string | null;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
}

export interface MissionEventRecord {
  id: string;
  seq: number;
  type: MissionEventType;
  nodeKey: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  demo: boolean;
  createdAt: string;
}

const MAX_PAYLOAD_TEXT = 20_000;

function sanitizePayload(payload: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  const json = JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>;
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === "string" && v.length > MAX_PAYLOAD_TEXT) json[k] = v.slice(0, MAX_PAYLOAD_TEXT) + "…";
  }
  return json as Prisma.InputJsonValue;
}

/** Append events inside an existing transaction. Returns the assigned seqs. */
export async function appendMissionEventsTx(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; missionTaskId: string; demo?: boolean; events: MissionEventInput[] }
): Promise<number[]> {
  if (!input.events.length) return [];
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    `kern-mission-events:${input.missionTaskId}`
  );
  const last = await tx.kernMissionEvent.findFirst({
    where: { missionTaskId: input.missionTaskId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  let seq = last?.seq ?? 0;
  const seqs: number[] = [];
  await tx.kernMissionEvent.createMany({
    data: input.events.map((e) => {
      seq += 1;
      seqs.push(seq);
      return {
        organizationId: input.organizationId,
        missionTaskId: input.missionTaskId,
        seq,
        type: e.type,
        nodeKey: e.nodeKey ?? null,
        actorUserId: e.actorUserId ?? null,
        payload: sanitizePayload(e.payload),
        demo: input.demo ?? false,
      };
    }),
  });
  return seqs;
}

/** Append outside a transaction (executor side). Never throws: telemetry must not fail work. */
export async function appendMissionEvents(input: {
  organizationId: string;
  missionTaskId: string;
  demo?: boolean;
  events: MissionEventInput[];
}): Promise<number[]> {
  try {
    return await prisma.$transaction((tx) => appendMissionEventsTx(tx, input));
  } catch (error) {
    console.error(
      `[kern-events] append failed ${input.missionTaskId}:`,
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

function toRecord(row: {
  id: string;
  seq: number;
  type: string;
  nodeKey: string | null;
  actorUserId: string | null;
  payload: Prisma.JsonValue;
  demo: boolean;
  createdAt: Date;
}): MissionEventRecord {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type as MissionEventType,
    nodeKey: row.nodeKey,
    actorUserId: row.actorUserId,
    payload: (row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {}) as Record<string, unknown>,
    demo: row.demo,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Owner check shared by events/stream routes. Returns root status. */
export async function assertMissionOwner(session: SessionContext, missionTaskId: string) {
  const root = await prisma.agentTask.findUnique({
    where: { id: missionTaskId },
    select: { organizationId: true, status: true, contextSnapshot: true },
  });
  const snap = root?.contextSnapshot as Record<string, unknown> | null | undefined;
  if (
    !root ||
    root.organizationId !== session.organizationId ||
    snap?.schemaVersion !== "kern-mission/v1" ||
    snap.requestedByUserId !== session.userId
  ) {
    throw new NotFoundError("Mission not found");
  }
  return { status: root.status, finished: !!snap.outcome };
}

export async function listMissionEvents(
  session: SessionContext,
  missionTaskId: string,
  afterSeq = 0,
  limit = 500
): Promise<MissionEventRecord[]> {
  await assertMissionOwner(session, missionTaskId);
  return listMissionEventsUnchecked(session.organizationId, missionTaskId, afterSeq, limit);
}

/** Caller must have already checked ownership. */
export async function listMissionEventsUnchecked(
  organizationId: string,
  missionTaskId: string,
  afterSeq = 0,
  limit = 500
): Promise<MissionEventRecord[]> {
  const rows = await prisma.kernMissionEvent.findMany({
    where: { organizationId, missionTaskId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
    take: Math.min(Math.max(limit, 1), 1000),
  });
  return rows.map(toRecord);
}

/** Format one Server-Sent Event frame (id = seq so Last-Event-ID resumes). */
export function formatSseEvent(event: MissionEventRecord): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
