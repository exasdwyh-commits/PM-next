import { createHash } from "node:crypto";
/** Durable, unverified source snapshots in the existing mission event log. */
import { listMissionEventsUnchecked, type MissionEventRecord } from "./events";

export interface MissionSource {
  sourceId: string;
  eventId: string;
  nodeKey: string;
  title: string;
  url: string;
  fetchedAt: string;
  sourceKind: "SEARCH_RESULT" | "FETCHED_PAGE";
  contentHash: string;
  snapshot: string;
  truncated: boolean;
}

export async function loadMissionSourceEvents(organizationId: string, missionTaskId: string) {
  const events: MissionEventRecord[] = [];
  let after = 0;
  for (;;) {
    const page = await listMissionEventsUnchecked(organizationId, missionTaskId, after, 1000);
    events.push(...page);
    if (page.length < 1000) return events;
    after = page[page.length - 1].seq;
  }
}

/** Rerun, skip and retraction invalidate old citations; late old-task returns are ignored. */
export function collectMissionSources(events: MissionEventRecord[]): MissionSource[] {
  const byNode = new Map<string, Map<string, MissionSource>>();
  const currentTask = new Map<string, string>();
  const inactive = new Set<string>();
  for (const event of events) {
    if (event.demo) continue;
    const key = event.nodeKey ?? "";
    if (event.type === "node.rerun" || event.type === "node.retracted" || event.type === "node.skipped") {
      const reset = Array.isArray(event.payload.resetKeys) ? event.payload.resetKeys : [key];
      for (const k of reset) if (typeof k === "string") {
        byNode.delete(k); inactive.add(k); currentTask.delete(k);
      }
    }
    if (event.type === "node.dispatched" || event.type === "node.started") {
      const id = event.payload.taskId;
      if (event.type === "node.started" && currentTask.has(key) && id !== currentTask.get(key)) continue;
      if (typeof id === "string" && id !== currentTask.get(key)) {
        byNode.delete(key); currentTask.set(key, id);
      }
      inactive.delete(key);
    }
    if (event.type !== "node.cite" || !key || inactive.has(key)) continue;
    const p = event.payload;
    if (typeof p.taskId === "string" && currentTask.has(key) && p.taskId !== currentTask.get(key)) continue;
    if (typeof p.url !== "string" || typeof p.sourceId !== "string" ||
        typeof p.snapshot !== "string" || typeof p.contentHash !== "string" ||
        typeof p.fetchedAt !== "string" || !Number.isFinite(Date.parse(p.fetchedAt)) ||
        (p.sourceKind !== "SEARCH_RESULT" && p.sourceKind !== "FETCHED_PAGE")) continue;
    try { const u = new URL(p.url); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) continue; } catch { continue; }
    if (createHash("sha256").update(p.snapshot).digest("hex") !== p.contentHash) continue;
    const source: MissionSource = {
      sourceId: p.sourceId, eventId: typeof p.eventId === "string" ? p.eventId : event.id, nodeKey: key,
      title: typeof p.title === "string" ? p.title : p.url,
      url: p.url, fetchedAt: p.fetchedAt, sourceKind: p.sourceKind,
      contentHash: p.contentHash, snapshot: p.snapshot, truncated: p.truncated === true,
    };
    const sources = byNode.get(key) ?? new Map<string, MissionSource>();
    sources.set(source.sourceId, source); byNode.set(key, sources);
  }
  return [...byNode.values()].flatMap((m) => [...m.values()]);
}

export function uniqueMissionSources(sources: MissionSource[]) {
  return [...new Map(sources.map((s) => [s.sourceId, s])).values()];
}
