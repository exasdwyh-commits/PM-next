/**
 * Mission → ResponseEnvelope (docs/KERN_RESPONSE_SPEC.md), built on read.
 *
 * Why on read and not stored on the message: the report keeps changing after
 * the conclusion message is written (takeaway receipts, reruns), and a stored
 * envelope would go stale. Everything here is derived from the mission
 * snapshot + event log, so the envelope is always the current truth.
 */
import { getUsage } from "@/modules/billing";
import type { SessionContext } from "@/modules/identity/session";
import { envelopeFromMission } from "@/modules/response-format/from-mission";
import type { ResponseEnvelope } from "@/modules/response-format/types";

import { listMissionEvents } from "./events";
import { loadMissionReport } from "./takeaway";

export async function missionResponseEnvelope(session: SessionContext, missionTaskId: string): Promise<ResponseEnvelope> {
  const report = await loadMissionReport(session, missionTaskId);
  const events = await listMissionEvents(session, missionTaskId, 0, 1000);

  const calls = events.filter((e) => e.type === "node.tool" && e.payload.tool === "model_call" && e.payload.ok !== false);
  const models = [...new Set(calls.map((e) => e.payload.model).filter((m): m is string => typeof m === "string" && !!m))];
  const elapsedMs = calls.reduce((sum, e) => sum + (typeof e.payload.latencyMs === "number" ? e.payload.latencyMs : 0), 0);

  let quota: { used: number; limit: number | null } | null = null;
  if (!report.demo) {
    const usage = await getUsage(session.organizationId);
    quota = { used: usage.used.missions, limit: usage.limits.missionsPerMonth };
  }

  return envelopeFromMission(report, {
    model: report.demo ? "演示脚本" : models.length ? models.join("、") : "未记录",
    elapsedMs,
    quota,
    sources: 0, // P0-B (research capability) will populate real SourceCaptures.
  });
}
