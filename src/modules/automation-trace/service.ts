import { Prisma } from "@prisma/client";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";

function stringArray(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function resultValue(value: Prisma.JsonValue | null | undefined): string | boolean | number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).value;
  return typeof raw === "string" || typeof raw === "boolean" || typeof raw === "number"
    ? raw
    : null;
}

export interface AutomationTraceQuery {
  aggregateType?: string;
  aggregateIds?: string[];
  limit?: number;
}

export async function listAutomationTraces(
  session: SessionContext,
  query: AutomationTraceQuery = {}
) {
  const aggregateIds = (query.aggregateIds ?? []).filter(Boolean);
  if (query.aggregateIds && aggregateIds.length === 0) return [];

  const rows = await prisma.businessEvent.findMany({
    where: {
      organizationId: session.organizationId,
      ...(query.aggregateType ? { aggregateType: query.aggregateType } : {}),
      ...(aggregateIds.length > 0 ? { aggregateId: { in: aggregateIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(query.limit ?? 30, 100)),
    include: {
      autopilotReceipt: {
        include: {
          autopilot: {
            select: {
              id: true,
              key: true,
              name: true,
              actionKind: true,
              status: true,
            },
          },
          decisionRun: {
            select: {
              id: true,
              decisionKey: true,
              specVersion: true,
              engine: true,
              engineVersion: true,
              resultJson: true,
              reasonCodes: true,
              policyAction: true,
              policyReasons: true,
              createdAt: true,
            },
          },
          agentTask: {
            select: {
              id: true,
              goal: true,
              status: true,
              triggerType: true,
              createdAt: true,
              agent: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((event) => {
    const receipt = event.autopilotReceipt;
    const decision = receipt?.decisionRun ?? null;
    return {
      id: event.id,
      eventKey: event.eventKey,
      eventType: event.eventType,
      eventStatus: event.status,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      createdAt: event.createdAt,
      dispatchedAt: event.dispatchedAt,
      lastError: event.lastError,
      receipt: receipt
        ? {
            id: receipt.id,
            status: receipt.status,
            suppressionReason: receipt.suppressionReason,
            errorReason: receipt.errorReason,
            autopilot: receipt.autopilot,
          }
        : null,
      decision: decision
        ? {
            id: decision.id,
            decisionKey: decision.decisionKey,
            specVersion: decision.specVersion,
            engine: decision.engine,
            engineVersion: decision.engineVersion,
            value: resultValue(decision.resultJson),
            reasonCodes: stringArray(decision.reasonCodes),
            policyAction: decision.policyAction,
            policyReasons: stringArray(decision.policyReasons),
            createdAt: decision.createdAt,
          }
        : null,
      agentTask: receipt?.agentTask ?? null,
    };
  });
}

export type AutomationTrace = Awaited<ReturnType<typeof listAutomationTraces>>[number];

export async function mapAutomationTracesByAggregate(
  session: SessionContext,
  aggregateType: string,
  aggregateIds: string[]
) {
  const traces = await listAutomationTraces(session, {
    aggregateType,
    aggregateIds,
    limit: Math.min(Math.max(aggregateIds.length * 2, 20), 100),
  });
  const map: Record<string, AutomationTrace[]> = {};
  for (const trace of traces) {
    (map[trace.aggregateId] ??= []).push(trace);
  }
  return map;
}
