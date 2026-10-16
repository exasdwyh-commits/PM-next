/** Existing Artifact rows hold versioned presentation JSON; no schema migration or GET-side model calls. */
import { createHash } from "node:crypto";
import prisma from "@/shared/db";
import { REPORT_CONTENT_SCHEMA, type ReportContentDocument } from "@/shared/report-content";
import { lockExecutorGuardTx, ExecutionStoppedError, type ExecutorGuard } from "@/modules/worker/claim";
import type { ReportContentStore } from "./report-content-agent";
const TYPE = "MISSION_REPORT_CONTENT";
export function reportContentArtifactId(organizationId: string, nodeTaskId: string, inputVersion: string): string {
  return `report-content-${createHash("sha256").update(JSON.stringify([organizationId, nodeTaskId, inputVersion])).digest("hex")}`;
}
export async function readReportContentArtifact(organizationId: string, id: string, missionTaskId: string, nodeTaskId: string, inputVersion: string): Promise<ReportContentDocument | null> {
  const row = await prisma.artifact.findFirst({ where: { id, organizationId, type: TYPE, schemaVersion: REPORT_CONTENT_SCHEMA } });
  if (!row) return null;
  try {
    const document = JSON.parse(row.content) as ReportContentDocument;
    if (document.schemaVersion !== REPORT_CONTENT_SCHEMA || document.missionTaskId !== missionTaskId || document.nodeTaskId !== nodeTaskId || document.inputVersion !== inputVersion) return null;
    if (!["DRAFT", "READY", "REJECTED", "FAILED"].includes(document.status) || typeof document.title !== "string" || typeof document.summary !== "string"
      || typeof document.subject !== "string" || !document.source || typeof document.source.body !== "string"
      || ![document.risks, document.unknowns, document.decisions, document.actions].every(items => Array.isArray(items) && items.every(item => typeof item === "string"))
      || !document.layout || !["comfortable", "compact"].includes(document.layout.density) || ![3, 4, 5].includes(document.layout.summaryLines)) return null;
    return document;
  } catch { return null; }
}
export function reportContentStore(guard: ExecutorGuard, missionTaskId: string, inputVersion: string): { id: string; store: ReportContentStore } {
  const id = reportContentArtifactId(guard.organizationId, guard.taskId, inputVersion);
  return { id, store: {
    read: () => readReportContentArtifact(guard.organizationId, id, missionTaskId, guard.taskId, inputVersion),
    write: async document => {
      await prisma.$transaction(async tx => {
        // Existing root -> child locks bind every write to the current lease, run and active revision.
        await lockExecutorGuardTx(tx, guard);
        const lease = await tx.$queryRaw<Array<{ valid: boolean }>>`
          SELECT (COALESCE("contextSnapshot" -> 'executorLease' ->> 'expiresAt', '') <> ''
            AND ("contextSnapshot" -> 'executorLease' ->> 'expiresAt')::timestamptz > now()) AS valid
          FROM "AgentTask" WHERE id = ${guard.taskId} AND "organizationId" = ${guard.organizationId}
        `;
        if (lease[0]?.valid !== true) throw new ExecutionStoppedError("执行租约已过期");
        await tx.artifact.upsert({ where: { id, organizationId: guard.organizationId }, create: { id, organizationId: guard.organizationId, type: TYPE,
          schemaVersion: REPORT_CONTENT_SCHEMA, title: document.title, content: JSON.stringify(document), producerType: "AI" },
          update: { title: document.title, content: JSON.stringify(document), contentVersion: { increment: 1 } },
        });
      });
    },
  } };
}
